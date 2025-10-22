/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { Session } = require('node:inspector')
const logger = require('../logger').child({ component: 'profiler' })

const PROFILING_TYPE_CPU = 0x01
const PROFILING_TYPE_HEAP = 0x02

module.exports = { initialize }

function initialize(api) {
  const { agent } = api
  const profiler = new Profiler(api)

  agent.once('started', function afterStart() {
    profiler.start(function afterStartProfiler(err) {
      if (err) {
        logger.error('Failed to start profiler:', err)
      }
    })
  })

  agent.once('stopped', function afterStop() {
    profiler.stop(function afterStopProfiler(err) {
      if (err) {
        logger.error('Failed to stop profiler:', err)
      }
    })
  })
}

function Profiler(api) {
  if (!api) {
    throw new Error('Must be initialized with an API.')
  }

  const { agent } = api

  this.api = api
  this.harvestSeq = 0
  this.selectedProfiles = _parseProfilingTypes(agent.config)
  this.cpuReportInterval = agent.config.profiling.cpu_report_interval
  this.cpuSampleRateMicros = agent.config.profiling.cpu_sample_rate_micros
  this.heapReportInterval = agent.config.profiling.heap_report_interval
  this.heapSampleIntervalBytes =
    agent.config.profiling.heap_sample_interval_bytes
  this.heapSampleStackDepth = agent.config.profiling.heap_sample_stack_depth
  this.heapSampleStartTime = 0
}

Profiler.prototype.start = function start(callback) {
  logger.trace('Starting profiler...')

  if (this.selectedProfiles === 0) {
    logger.trace('No profiling types selected. Nothing to do.')
    return
  }

  this.session = new Session()

  logger.trace('Connecting to inspector...')

  this.session.connect()

  const profiler = this

  this._maybeStartCpuProfiler(function afterStartCpuProfiler(err) {
    if (err) {
      callback(err)
      return
    }

    profiler._maybeStartHeapProfiler(function afterStartHeapProfiler(err) {
      if (err) {
        callback(err)
        profiler.stop()
        return
      }

      profiler._scheduleHarvests()

      logger.trace('Profiler started successfully')

      callback()
    })
  })
}

Profiler.prototype.stop = function stop(callback) {
  logger.trace('Stopping profiler...')

  const profiler = this

  this._maybeStopCpuProfiler(function afterStopCpuProfiler(err) {
    if (err) {
      // Log the error but keep shutting down
      logger.error(err)
    }

    clearInterval(profiler.cpuTimer)

    profiler._maybeStopHeapProfiler(function afterStopHeapProfiler(err) {
      if (err) {
        // Log the error but keep shutting down
        logger.error(err)
      }

      clearInterval(profiler.heapTimer)

      profiler.session.disconnect()

      logger.trace('Profiler stopped successfully')

      callback()
    })
  })
}

Profiler.prototype._maybeStartCpuProfiler = function _maybeStartCpuProfiler(
  callback
) {
  const session = this.session

  if ((this.selectedProfiles & PROFILING_TYPE_CPU) === 0) {
    process.nextTick(callback)
    return
  }

  session.post(
    'Profiler.setSamplingInterval',
    { interval: this.cpuSampleRateMicros },
    function afterSetSamplingInterval(err) {
      if (err) {
        logger.error('Failed to set CPU sampling interval:', err)
        callback(err)
        return
      }

      session.post('Profiler.enable', function afterEnableCpuProfiler(err) {
        if (err) {
          logger.error('Failed to enable CPU profiler:', err)
          callback(err)
          return
        }

        session.post('Profiler.start', function afterStartCpuProfiler(err) {
          if (err) {
            logger.error('Failed to start CPU profiler:', err)
            callback(err)
            return
          }

          logger.trace('CPU Profiler started successfully')

          callback()
        })
      })
    }
  )
}

Profiler.prototype._maybeStopCpuProfiler = function _maybeStopCpuProfiler(
  callback
) {
  const session = this.session

  if ((this.selectedProfiles & PROFILING_TYPE_CPU) === 0) {
    process.nextTick(callback)
    return
  }

  session.post('Profiler.stop', function afterStopCpuProfiler(err) {
    if (err) {
      logger.error('Failed to stop CPU profiler:', err)
      callback(err)
      return
    }

    session.post('Profiler.disable', function afterDisableCpuProfiler(err) {
      if (err) {
        logger.error('Failed to disable CPU profiler:', err)
        callback(err)
        return
      }

      callback()
    })
  })
}

Profiler.prototype._maybeStartHeapProfiler = function _maybeStartHeapProfiler(
  callback
) {
  const profiler = this
  const session = this.session

  if ((this.selectedProfiles & PROFILING_TYPE_HEAP) === 0) {
    process.nextTick(callback)
    return
  }

  session.post('HeapProfiler.enable', function afterEnableHeapProfiler(err) {
    if (err) {
      logger.error('Failed to enable Heap profiler:', err)
      callback(err)
      return
    }

    session.post(
      'HeapProfiler.startSampling',
      {
        samplingInterval: profiler.heapSampleIntervalBytes,
        stackDepth: profiler.heapSampleStackDepth,
      },
      function afterStartHeapProfiler(err) {
        if (err) {
          logger.error('Failed to start Heap profiler:', err)
          callback(err)
          return
        }

        profiler.heapSampleStartTime = Date.now()

        logger.trace('Heap Profiler started successfully')

        callback()
      }
    )
  })
}

Profiler.prototype._maybeStopHeapProfiler = function _maybeStopHeapProfiler(
  callback
) {
  const session = this.session

  if ((this.selectedProfiles & PROFILING_TYPE_HEAP) === 0) {
    process.nextTick(callback)
    return
  }

  session.post('HeapProfiler.stopSampling', function afterStopHeapProfiler(
    err
  ) {
    if (err) {
      logger.error('Failed to stop Heap profiler:', err)
      callback(err)
      return
    }

    session.post('HeapProfiler.disable', function afterDisableHeapProfiler(
      err
    ) {
      if (err) {
        logger.error('Failed to disable Heap profiler:', err)
        callback(err)
        return
      }

      callback()
    })
  })
}

Profiler.prototype._scheduleHarvests = function _scheduleHarvests() {
  const profiler = this

  if (this.selectedProfiles & PROFILING_TYPE_CPU) {
    this.cpuTimer = setInterval(function _harvestCpuSamples() {
      profiler._collectCpuSamples()
    }, this.cpuReportInterval)
    this.cpuTimer.unref()
  }

  if (this.selectedProfiles & PROFILING_TYPE_HEAP) {
    this.heapTimer = setInterval(async function _harvestHeapSamples() {
      profiler._collectHeapSamples()
    }, this.heapReportInterval)
    this.heapTimer.unref()
  }
}

Profiler.prototype._collectCpuSamples = function _collectCpuSamples() {
  const profiler = this
  const session = this.session

  logger.trace('Stopping CPU profiler to collect samples...')

  session.post('Profiler.stop', function afterStopCpuProfiler(
    err,
    { profile }
  ) {
    if (err) {
      logger.error('Failed to stop CPU profiler to collect samples:', err)
      return
    }

    logger.trace(
      `CPU profiler stopped. Recording ${profile.samples.length} samples...`
    )

    const events = _marshalCpuProfileToEvents(profiler.harvestSeq, profile)

    logger.trace(`Recording ${events.length} ProfileCPU events...`)

    for (const event of events) {
      profiler.api.recordCustomEvent('ProfileCPU', event)
    }

    logger.trace('Restarting CPU profiler after collecting samples...')

    session.post('Profiler.start', function afterStartCpuProfiler(err) {
      if (err) {
        logger.error(
          'Failed to restart CPU profiler after collecting samples:',
          err
        )
        return
      }

      profiler.harvestSeq += 1

      logger.trace('CPU Profiler restarted successfully')
    })
  })
}

Profiler.prototype._collectHeapSamples = function _collectHeapSamples() {
  const profiler = this
  const session = this.session

  logger.trace('Collecting heap samples...')

  session.post(
    'HeapProfiler.getSamplingProfile',
    function afterGetSamplingProfile(err, profile) {
      if (err) {
        logger.error('Failed to get heap sampling profile:', err)
        return
      }

      logger.trace(
        `Heap sampling profile retrieved. Recording ${profile.profile.samples.length} samples...`
      )

      const events = _marshalHeapSamplingProfileToEvents(
        profiler.harvestSeq,
        profiler.heapSampleStartTime,
        profile
      )

      logger.trace(`Recording ${events.length} ProfileHeap events...`)

      for (const event of events) {
        profiler.api.recordCustomEvent('ProfileHeap', event)
      }

      profiler.harvestSeq += 1
      profiler.heapSampleStartTime = Date.now()
    }
  )
}

function _parseProfilingTypes(config) {
  let profilingType = 0

  if (!config.profiling.types) {
    return profilingType
  }

  for (const type of config.profiling.types) {
    switch (type.toLowerCase()) {
      case 'cpu':
        profilingType |= PROFILING_TYPE_CPU
        break
      case 'heap':
        profilingType |= PROFILING_TYPE_HEAP
        break
    }
  }

  return profilingType
}

function _marshalCpuProfileToEvents(harvestSeq, profile) {
  const {
    nodes,
    samples,
    startTime,
    endTime,
    timeDeltas,
  } = profile
  const nodeMap = {}

  // First, build a map of node IDs to their corresponding node objects
  // for quick access to nodes by ID and to add the parent property
  for (const node of nodes) {
    const { id } = node

    node.parent = null

    nodeMap[id] = node
  }

  // Next, set the parent node for each child for easy traversal from a child
  // node to the root node
  for (const node of nodes) {
    const n = nodeMap[node.id]

    if (!n.children) {
      continue
    }

    for (const child of n.children) {
      const childNode = nodeMap[child]

      if (childNode) {
        childNode.parent = n
      }
    }
  }

  // Now build the events by iterating the samples
  const events = []
  let count = 0
  let sum = 0

  for (let i = 0; i < samples.length; i += 1) {
    let delta = 0

    // Calculate the delta for the current sample. The delta represents the time
    // between the current sample and the previous sample and is used as the
    // measure of how long the function for the current sample was executing.
    if (i < timeDeltas.length - 1) {
      // We always look ahead a delta because the length of the current sample
      // is determined as the time between the next sample and the current
      // sample. This means we skip the first delta because it is the delta from
      // when the profiler started until when the first sample was taken.
      delta = timeDeltas[i + 1]
      count += 1
      sum += delta
    } else {
      // The final delta isn't provided in the timeDeltas array so we calculate
      // it as the average of all the other time deltas
      delta = Math.floor(sum / count)
    }

    events.push(_addLocation({
      harvest_seq: harvestSeq,
      sample_seq: i,
      // @todo what is the right value here?
      sample_period_cpu_nanoseconds: delta * 1000,
      duration_ns: (endTime - startTime) * 1000,
      time_ns: startTime * 1000,
      cpu_nanoseconds: delta * 1000,
      samples_count: samples.length,
    }, samples[i], nodeMap))
  }

  return events
}

function _marshalHeapSamplingProfileToEvents(
  harvestSeq,
  heapSampleStartTime,
  profile
) {
  const {
    head,
    samples,
  } = profile.profile
  const nodeMap = {}

  nodeMap[head.id] = head

  // First, build a map of node IDs to their corresponding node objects
  // for quick access to nodes by ID and to add the parent property. Building
  // the heap node map needs to be done recursively because the nodes are not
  // provided as a flat structure like the CPU profile but as a tree of nodes.
  _buildHeapNodeMap(head, nodeMap)

  // Now build the events by iterating the samples
  const events = []

  for (let i = 0; i < samples.length; i += 1) {
    const { nodeId } = samples[i]
    // We need to walk up to the root to calculate the functions inclusive size.
    const size = _calculateInclusiveSize(nodeId, nodeMap)
    const endTime = Date.now()

    events.push(_addLocation({
      harvest_seq: harvestSeq,
      sample_seq: i,
      // @todo - what is the right value here?
      sample_period_inuse_space_bytes: size,
      duration_ns: (endTime - heapSampleStartTime) * 1000,
      time_ns: heapSampleStartTime * 1000,
      inuse_space_bytes: size,
      samples_count: samples.length,
    }, nodeId, nodeMap))
  }

  return events
}

function _buildHeapNodeMap(parent, nodeMap, childIndex = 0) {
  const { children } = parent

  if (!Array.isArray(children) || childIndex >= children.length) {
    return
  }

  const child = children[childIndex]
  child.parent = parent

  nodeMap[child.id] = child

  // Recurse through the child nodes
  _buildHeapNodeMap(child, nodeMap)

  // Recurse through the sibling nodes
  _buildHeapNodeMap(parent, nodeMap, childIndex + 1)
}

function _calculateInclusiveSize(nodeId, nodeMap) {
  let size = 0

  for (let node = nodeMap[nodeId]; node; node = node.parent) {
    size += node.selfSize
  }

  return size
}

function _addLocation(event, sampleId, nodeMap) {
  const location = []

  for (let node = nodeMap[sampleId]; node; node = node.parent) {
    location.push(_locationFromCallFrame(node))
  }

  let j = location.length - 1

  for (let i = 0; i < location.length; i += 1, j -= 1) {
    event[`location.${i}`] = location[j]
  }

  return event
}

function _locationFromCallFrame(frame) {
  const { callFrame } = frame
  const name = callFrame.functionName ? callFrame.functionName : '(unknown)'

  return `${name}:${callFrame.lineNumber}`
}
