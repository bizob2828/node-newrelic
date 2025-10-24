/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { time, heap, encode } = require('@datadog/pprof')
const { open } = require('node:fs/promises')
const path = require('node:path')

const logger = require('../logger').child({ component: 'profiler' })

const PROFILING_TYPE_CPU = 0x01
const PROFILING_TYPE_HEAP = 0x02

const DESTINATION_TYPE_NIL = 0x00
const DESTINATION_TYPE_LOCAL_FILE = 0x01
const DESTINATION_TYPE_INGEST_OTEL = 0x02
const DESTINATION_TYPE_INGEST_MELT = 0x03

module.exports = { initialize }

function initialize(api) {
  const { agent } = api
  const profiler = new Profiler(api)

  agent.once('started', function afterStart() {
    try {
      profiler.start()
    } catch (err) {
      logger.error('Failed to start profiler:')
      logger.error(err)
    }
  })

  agent.once('stopped', function afterStop() {
    try {
      profiler.stop()
    } catch (err) {
      logger.error('Failed to stop profiler:')
      logger.error(err)
    }
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
  this.heapReportInterval = agent.config.profiling.heap_report_interval
  this.heapSampleIntervalBytes =
    agent.config.profiling.heap_sample_interval_bytes
  this.heapSampleStackDepth = agent.config.profiling.heap_sample_stack_depth
  this.destination = _parseDestination(agent.config)
  this.outputDirectory = agent.config.profiling.output_directory
}

Profiler.prototype.start = async function start() {
  logger.trace('Starting profiler...')

  if (this.selectedProfiles === 0) {
    logger.trace('No profiling types selected. Nothing to do.')
    return
  }

  if (this.selectedProfiles & PROFILING_TYPE_CPU) {
    logger.trace('Starting CPU profiler...')
    time.start()
  }

  if (this.selectedProfiles & PROFILING_TYPE_HEAP) {
    logger.trace('Starting Heap profiler...')
    heap.start(this.heapSampleIntervalBytes, this.heapSampleStackDepth)
  }

  if (this.destination === DESTINATION_TYPE_LOCAL_FILE) {
    await this._openLocalFiles()
  }

  this._scheduleHarvests()

  logger.trace('Profiler started successfully')
}

Profiler.prototype.stop = async function stop() {
  logger.trace('Stopping profiler...')

  if (this.selectedProfiles & PROFILING_TYPE_CPU) {
    logger.trace('Stopping CPU profiler...')
    time.stop(false)
    clearInterval(this.cpuTimer)
  }

  if (this.selectedProfiles & PROFILING_TYPE_HEAP) {
    logger.trace('Stopping Heap profiler...')
    heap.stop()
    clearInterval(this.heapTimer)
  }

  await this._closeLocalFiles()

  logger.trace('Profiler stopped successfully')
}

Profiler.prototype._scheduleHarvests = function _scheduleHarvests() {
  const profiler = this

  if (this.selectedProfiles & PROFILING_TYPE_CPU) {
    this.cpuTimer = setInterval(async function _harvestCpuSamples() {
      try {
        await profiler._collectCpuSamples()
        profiler.harvestSeq += 1
      } catch (err) {
        logger.error('Error harvesting CPU samples:')
        logger.error(err)
      }
    }, this.cpuReportInterval)
    this.cpuTimer.unref()
  }

  if (this.selectedProfiles & PROFILING_TYPE_HEAP) {
    this.heapTimer = setInterval(async function _harvestHeapSamples() {
      try {
        await profiler._collectHeapSamples()
        profiler.harvestSeq += 1
      } catch (err) {
        logger.error('Error harvesting Heap samples:')
        logger.error(err)
      }
    }, this.heapReportInterval)
    this.heapTimer.unref()
  }
}

Profiler.prototype._collectCpuSamples = async function _collectCpuSamples() {
  if ((this.selectedProfiles & PROFILING_TYPE_CPU) === 0) {
    logger.trace('No CPU profiling selected. Skipping CPU sample collection.')
    return
  }

  if (this.destination === DESTINATION_TYPE_NIL) {
    logger.trace('No profiling destination set. Skipping CPU sample collection.')
    return
  }

  logger.trace('Stopping CPU profiler to collect samples...')

  const profile = time.stop(true)

  logger.trace(
    `CPU profiler stopped. Recording ${profile.sample.length} samples...`
  )

  if (this.destination === DESTINATION_TYPE_LOCAL_FILE) {
    logger.trace('Writing CPU profile to local file...')
    await this.cpuFile.write(await encode(profile))
    await this.cpuFile.close()

    logger.trace('Creating new CPU profile file...')
    this.cpuFile = await open(
      path.join(this.outputDirectory, `cpu.pprof${this.harvestSeq}`),
      'ax',
      0o644
    )
    return
  }

  _recordSamples(
    this.api,
    'ProfileCPU',
    this.harvestSeq,
    profile,
    this.destination
  )
}

Profiler.prototype._collectHeapSamples = async function _collectHeapSamples() {
  if ((this.selectedProfiles & PROFILING_TYPE_HEAP) === 0) {
    logger.trace('No Heap profiling selected. Skipping Heap sample collection.')
    return
  }

  if (this.destination === DESTINATION_TYPE_NIL) {
    logger.trace('No profiling destination set. Skipping Heap sample collection.')
    return
  }

  logger.trace('Collecting heap samples...')

  const profile = heap.profile()

  logger.trace(
    `Heap sampling profile retrieved. Recording ${profile.sample.length} samples...`
  )

  if (this.destination === DESTINATION_TYPE_LOCAL_FILE) {
    logger.trace('Writing Heap profile to local file...')
    await this.heapFile.write(await encode(profile))
    await this.heapFile.close()

    logger.trace('Creating new Heap profile file...')
    this.heapFile = await open(
      path.join(this.outputDirectory, `heap.pprof${this.harvestSeq}`),
      'ax',
      0o644
    )
    return
  }

  _recordSamples(
    this.api,
    'ProfileHeap',
    this.harvestSeq,
    profile,
    this.destination
  )
}

Profiler.prototype._setProfileDestination = async function _setProfileDestination(
  destination
) {
  switch (destination) {
    case DESTINATION_TYPE_INGEST_OTEL:
    case DESTINATION_TYPE_INGEST_MELT:
    case DESTINATION_TYPE_NIL:
      if (this.destination === DESTINATION_TYPE_LOCAL_FILE) {
        await this._closeLocalFiles()
      }
      this.destination = destination
      break

    default:
      logger.warn(`Unknown profiling destination: ${destination}`)
  }
}

Profiler.prototype._setOutputDirectory = async function _setOutputDirectory(
  outputDirectory
) {
  this._closeLocalFiles()

  this.destination = DESTINATION_TYPE_LOCAL_FILE
  this.outputDirectory = outputDirectory

  await this._openLocalFiles()
}

Profiler.prototype._openLocalFiles = async function _openLocalFiles() {
  if (this.selectedProfiles & PROFILING_TYPE_CPU) {
    logger.trace('Creating CPU profile file...')

    this.cpuFile = await open(
      path.join(this.outputDirectory, 'cpu.pprof'),
      'ax',
      0o644
    )
  }

  if (this.selectedProfiles & PROFILING_TYPE_HEAP) {
    logger.trace('Creating Heap profile file...')

    this.heapFile = await open(
      path.join(this.outputDirectory, 'heap.pprof'),
      'ax',
      0o644
    )
  }
}

Profiler.prototype._closeLocalFiles = async function _closeLocalFiles() {
  if (this.destination !== DESTINATION_TYPE_LOCAL_FILE) {
    return
  }

  if (this.selectedProfiles & PROFILING_TYPE_CPU) {
    await this.cpuFile.close()
  }

  if (this.selectedProfiles & PROFILING_TYPE_HEAP) {
    await this.heapFile.close()
  }
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

function _parseDestination(config) {
  if (!config.profiling.destination) {
    return DESTINATION_TYPE_NIL
  }

  switch (config.profiling.destination.toLowerCase()) {
    // case 'otel':
    //   return DESTINATION_TYPE_INGEST_OTEL
    case 'melt':
      return DESTINATION_TYPE_INGEST_MELT
    case 'file':
      return DESTINATION_TYPE_LOCAL_FILE
  }

  logger.warn(`Unknown profiling destination: ${config.profiling.destination}`)

  return DESTINATION_TYPE_NIL
}

function _recordSamples(
  api,
  eventType,
  harvestSeq,
  profile,
  destination
) {
  const attrs = {
    harvest_seq: harvestSeq,
    time_ns: profile.timeNanos,
    duration_ns: profile.durationNanos,
    [`sample_period_${_normalizeAttrNameFromSampleValueType(
      _getString(profile, profile.periodType.type),
      _getString(profile, profile.periodType.unit)
    )}`]: profile.period
  }
  const u = {}
  let v = 0
  let prevLoc = 0

  for (let i = 0; i < profile.sample.length; i += 1) {
    const sample = profile.sample[i]

    attrs['sample_seq'] = i

    for (let j = 0; j < sample.value.length; j += 1) {
      const key = _normalizeAttrNameFromSampleValueType(
        _getString(profile, profile.sampleType[j].type),
        _getString(profile, profile.sampleType[j].unit)
      )

      attrs[key] = sample.value[j]
      u[key] = v
    }

    v = _cleanupKeys(attrs, u, v)

    // @todo add segments here

    const len = sample.locationId.length

    for (let j = 0; j < len; j += 1) {
      const loc = _getLocation(profile, sample.locationId[j])

      if (loc && loc.line.length > 0) {
        attrs[`location.${j}`] = _locationFromLine(profile, loc.line[0])
      } else if (attrs[`location.${j}`]) {
        delete attrs[`location.${j}`]
      }
    }

    for (let j = len; j < prevLoc; j += 1) {
      delete attrs[`location.${j}`]
    }

    prevLoc = len

    if (destination === DESTINATION_TYPE_INGEST_MELT) {
      api.recordCustomEvent(eventType, attrs)
    }
  }
}

function _cleanupKeys(attrs, keys, val) {
  for (const key in keys) {
    if (keys[key] !== val) {
      delete attrs[key]
      delete keys[key]
    }
  }

  return 1 - val
}

function _locationFromLine(profile, l) {
  const { functionId, line } = l

  let functionName = '(unknown)'

  for (const fn of profile.function) {
    if (fn.id === functionId) {
      functionName = _getString(profile, fn.name)
      break
    }
  }

  return `${functionName}:${line}`
}

function _getLocation(profile, locationId) {
  for (const loc of profile.location) {
    if (loc.id === locationId) {
      return loc
    }
  }
  return null
}

function _getString(profile, index) {
  return profile.stringTable.strings[index]
}

function _normalizeAttrNameFromSampleValueType(typeName, unitName) {
  return `${typeName}_${unitName}`.replace(
    /(\p{White_Space})|(\p{L})|(_)/u,
    (match, p1, p2, p3) => {
      if (p1) {
        // unicode white space character -> underscore
        return '_'
      }
      if (p2) {
        // unicode letter character -> itself
        return p2
      }
      if (p3) {
        // underscore character -> itself
        return p3
      }
      // any other character -> remove the character
      return ''
    }
  )
}
