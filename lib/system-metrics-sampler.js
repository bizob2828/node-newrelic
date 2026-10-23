/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const os = require('node:os')
const logger = require('./logger').child({ component: 'system-metrics-sampler' })
const Timer = require('./timer')

const NAMES = require('./metrics/names')

/*
 *
 * CONSTANTS
 *
 */
const MILLIS = 1e3
const MICROS = 1e6
const CPUS = os.cpus().length
const SAMPLE_INTERVAL = 15 * MILLIS

let samplers = []

function SystemMetricsSampler(sampler, interval) {
  this.id = setInterval(sampler, interval)
  this.id.unref()
}

SystemMetricsSampler.prototype.stop = function stop() {
  clearInterval(this.id)
}

function recordQueueTime(agent, timer) {
  timer.end()
  agent.metrics.measureMilliseconds(NAMES.EVENTS.WAIT, null, timer.getDurationInMillis())
}

function sampleMemory(agent) {
  return function memorySampler() {
    try {
      const mem = process.memoryUsage()
      agent.metrics.measureBytes(NAMES.MEMORY.PHYSICAL, mem.rss)
      agent.metrics.measureBytes(NAMES.MEMORY.USED_HEAP, mem.heapUsed)
      agent.metrics.measureBytes(NAMES.MEMORY.MAX_HEAP, mem.heapTotal)
      agent.metrics.measureBytes(NAMES.MEMORY.FREE_HEAP, mem.heapTotal - mem.heapUsed)
      agent.metrics.measureBytes(NAMES.MEMORY.USED_NONHEAP, mem.rss - mem.heapTotal)
      logger.trace(mem, 'Recorded memory')
    } catch (e) {
      logger.debug('Could not record memory usage', e)
    }
  }
}

function checkEvents(agent) {
  return function eventSampler() {
    const timer = new Timer()
    timer.begin()
    setTimeout(recordQueueTime.bind(null, agent, timer), 0)
  }
}

function getCpuSample(lastSample) {
  try {
    return process.cpuUsage(lastSample)
  } catch (e) {
    logger.debug('Could not record cpu usage', e)
    return null
  }
}

// userTime, sysTime, and elapsedUptime are in seconds
function recordInvocationCpu(agent, userTime, sysTime, elapsedUptime) {
  const totalCpuTime = CPUS * elapsedUptime

  const userUtil = userTime / totalCpuTime
  const sysUtil = sysTime / totalCpuTime

  recordValue(agent, NAMES.CPU.USER_TIME, userTime)
  recordValue(agent, NAMES.CPU.SYSTEM_TIME, sysTime)
  recordValue(agent, NAMES.CPU.USER_UTILIZATION, userUtil)
  recordValue(agent, NAMES.CPU.SYSTEM_UTILIZATION, sysUtil)
}

function generateCPUMetricRecorder(agent) {
  let lastSampleTime
  // userTime and sysTime are in seconds
  return function recordCPUMetrics(userTime, sysTime) {
    let elapsedUptime
    if (!lastSampleTime) {
      elapsedUptime = process.uptime()
    } else {
      elapsedUptime = (Date.now() - lastSampleTime) / MILLIS
    }

    lastSampleTime = Date.now()

    recordInvocationCpu(agent, userTime, sysTime, elapsedUptime)
  }
}

function sampleCpu(agent) {
  let lastSample
  const recordCPU = generateCPUMetricRecorder(agent)
  return function cpuSampler() {
    const cpuSample = getCpuSample(lastSample)
    lastSample = getCpuSample()

    if (lastSample == null) {
      return
    }

    recordCPU(cpuSample.user / MICROS, cpuSample.system / MICROS)
  }
}

function sampleLoop(agent, nativeMetrics) {
  return function loopSampler() {
    // Convert from microseconds to seconds
    const loopMetrics = nativeMetrics.getLoopMetrics()
    divideMetric(loopMetrics.usage, MICROS)

    recordCompleteMetric(agent, NAMES.LOOP.USAGE, loopMetrics.usage)
  }
}

function sampleGc(agent, nativeMetrics) {
  return function gcSampler() {
    const gcMetrics = nativeMetrics.getGCMetrics()

    for (const gcType of Object.keys(gcMetrics)) {
      // Convert from milliseconds to seconds.
      const gc = gcMetrics[gcType]
      divideMetric(gc.metrics, MILLIS)

      recordCompleteMetric(agent, NAMES.GC.PAUSE_TIME, gc.metrics)
      if (gc.type) {
        recordCompleteMetric(agent, NAMES.GC.PREFIX + gc.type, gc.metrics)
      } else {
        logger.debug(gc, 'Unknown GC type %j', gc.typeId)
      }
    }
  }
}

function loadNativeMetrics(agent) {
  // This requires a native module which may have failed to build.
  if (agent.config.plugins.native_metrics.enabled && !module.exports.nativeMetrics) {
    try {
      module.exports.nativeMetrics = require('@newrelic/native-metrics')({
        timeout: SAMPLE_INTERVAL
      })
    } catch (err) {
      logger.info(
        { error: { message: err.message, stack: err.stack } },
        'Not adding native metric sampler.'
      )
      agent.metrics
        .getOrCreateMetric(NAMES.SUPPORTABILITY.DEPENDENCIES + '/NoNativeMetricsModule')
        .incrementCallCount()
    }
  }

  if (module.exports.nativeMetrics && !module.exports.nativeMetrics.bound) {
    module.exports.nativeMetrics.bind(SAMPLE_INTERVAL)
  }
}

module.exports = {
  state: 'stopped',
  sampleMemory,
  checkEvents,
  sampleCpu,
  sampleGc,
  sampleLoop,
  nativeMetrics: null,

  start: function start(agent) {
    samplers.push(new SystemMetricsSampler(sampleMemory(agent), 5 * MILLIS))
    samplers.push(new SystemMetricsSampler(checkEvents(agent), SAMPLE_INTERVAL))

    loadNativeMetrics(agent)

    if (this.nativeMetrics) {
      // Add GC events if available.
      if (this.nativeMetrics.gcEnabled) {
        samplers.push(new SystemMetricsSampler(sampleGc(agent, this.nativeMetrics), SAMPLE_INTERVAL))
      }

      // Add loop metrics if available.
      if (this.nativeMetrics.loopEnabled) {
        samplers.push(new SystemMetricsSampler(sampleLoop(agent, this.nativeMetrics), SAMPLE_INTERVAL))
      }
    }

    // Add CPU sampling using the built-in data (introduced in 6.1.0)
    samplers.push(new SystemMetricsSampler(sampleCpu(agent), SAMPLE_INTERVAL))

    this.state = 'running'
  },

  // Loads (but does not start any interval-based sampling of) native
  // metrics. Used in serverless mode, where metrics are instead gathered
  // once per invocation via startInvocationSample/endInvocationSample,
  // scoped to that invocation's actual execution window.
  startServerless: function startServerless(agent) {
    loadNativeMetrics(agent)
    this.state = 'running'
  },

  // Takes a baseline CPU/time snapshot at the start of a single Lambda
  // invocation, to be passed to endInvocationSample once that invocation
  // finishes.
  startInvocationSample: function startInvocationSample() {
    return { cpu: process.cpuUsage(), time: Date.now() }
  },

  // Records memory, CPU, GC, and loop metrics for exactly the window
  // between startInvocationSample and now, rather than since some
  // previous interval tick.
  endInvocationSample: function endInvocationSample(agent, snapshot) {
    if (!snapshot) {
      return
    }

    sampleMemory(agent)()

    const cpuUsage = getCpuSample(snapshot.cpu)
    if (cpuUsage) {
      const elapsedUptime = (Date.now() - snapshot.time) / MILLIS
      recordInvocationCpu(agent, cpuUsage.user / MICROS, cpuUsage.system / MICROS, elapsedUptime)
    }

    if (this.nativeMetrics) {
      if (this.nativeMetrics.gcEnabled) {
        sampleGc(agent, this.nativeMetrics)()
      }
      if (this.nativeMetrics.loopEnabled) {
        sampleLoop(agent, this.nativeMetrics)()
      }
    }
  },

  stop: function stop() {
    for (const sampler of samplers) {
      sampler.stop()
    }
    samplers = []
    this.state = 'stopped'
    if (this.nativeMetrics) {
      this.nativeMetrics.unbind()
      this.nativeMetrics.removeAllListeners()

      // Setting this.nativeMetrics to null allows us to config a new
      // nativeMetrics object after the first start call.
      this.nativeMetrics = null
    }
  }
}

function recordValue(agent, metric, value) {
  const stats = agent.metrics.getOrCreateMetric(metric)
  stats.recordValue(value)
  logger.trace('Recorded metric %s: %j', metric, value)
}

function recordCompleteMetric(agent, metricName, metric) {
  const stats = agent.metrics.getOrCreateMetric(metricName)
  stats.merge(metric)
  logger.trace('Recorded metric %s: %j', metricName, metric)
}

function divideMetric(metric, divisor) {
  metric.min /= divisor
  metric.max /= divisor
  metric.total /= divisor
  metric.sumOfSquares /= divisor * divisor
}
