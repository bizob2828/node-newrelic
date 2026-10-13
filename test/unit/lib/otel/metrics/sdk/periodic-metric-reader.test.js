/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const PeriodicMetricReader = require('#agentlib/otel/metrics/sdk/periodic-metric-reader.js')
const { InstrumentType } = require('#agentlib/otel/constants.js')

const SCOPE = { name: 'scope', version: '', schemaUrl: '' }

function measurement(overrides = {}) {
  return {
    name: 'm',
    description: '',
    unit: '',
    instrumentationScope: SCOPE,
    type: InstrumentType.COUNTER,
    value: 1,
    attributes: {},
    timestamp: 1000,
    ...overrides
  }
}

function noopExporter() {
  return {
    export(_metrics, callback) { callback({ code: 0 }) },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve()
  }
}

// Interval chosen so the timer never fires during these tests unless a test
// specifically waits for it.
const LONG_INTERVAL = 1_000_000

test('resource defaults to empty attributes and is settable', async (t) => {
  const reader = new PeriodicMetricReader({ exporter: noopExporter(), exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  assert.deepEqual(reader.resource.attributes, {})
  reader.resource = { attributes: { a: '1' } }
  assert.deepEqual(reader.resource.attributes, { a: '1' })
})

test('record queues measurements for the next collect', async (t) => {
  const reader = new PeriodicMetricReader({ exporter: noopExporter(), exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  reader.record(measurement())
  const { resourceMetrics } = await reader.collect()
  assert.equal(resourceMetrics.metrics.size, 1)
})

test('collect() does not export', async (t) => {
  let exported = false
  const exporter = {
    export(_metrics, callback) { exported = true; callback({ code: 0 }) },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve()
  }
  const reader = new PeriodicMetricReader({ exporter, exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  reader.record(measurement())
  await reader.collect()
  assert.equal(exported, false)
})

test('forceFlush collects and exports pending measurements', async (t) => {
  let exportedMetrics = null
  const exporter = {
    export(metrics, callback) { exportedMetrics = metrics; callback({ code: 0 }) },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve()
  }
  const reader = new PeriodicMetricReader({ exporter, exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  reader.record(measurement())
  await reader.forceFlush()
  assert.ok(exportedMetrics)
  assert.equal(exportedMetrics.metrics.size, 1)
})

test('the timer periodically collects and exports', async (t) => {
  let exportCount = 0
  const exporter = {
    export(_metrics, callback) { exportCount += 1; callback({ code: 0 }) },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve()
  }
  const reader = new PeriodicMetricReader({ exporter, exportIntervalMillis: 20 })
  t.after(() => reader.shutdown())

  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.ok(exportCount >= 2, `expected multiple timer-driven exports, got ${exportCount}`)
})

test('record drops measurements once the queue is full', async (t) => {
  const reader = new PeriodicMetricReader({ exporter: noopExporter(), exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  const MAX_QUEUE_SIZE = 65_536
  for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
    // Each measurement carries a unique attribute set, so each becomes its
    // own data point -- making it easy to assert exactly how many survived.
    reader.record(measurement({ attributes: { i: String(i) } }))
  }
  const { resourceMetrics } = await reader.collect()
  const metric = [...resourceMetrics.metrics.values()][0]
  assert.equal(metric.dataPoints.size, MAX_QUEUE_SIZE)
})

test('observable instruments are polled synchronously at collection time', async (t) => {
  const reader = new PeriodicMetricReader({ exporter: noopExporter(), exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  let called = false
  reader.observableInstruments.add({
    collect() {
      called = true
      return [measurement({ type: InstrumentType.OBSERVABLE_GAUGE, value: 42 })]
    }
  })

  const { resourceMetrics } = await reader.collect()
  assert.equal(called, true)
  assert.equal(resourceMetrics.metrics.size, 1)
})

test('batch observable callbacks are polled at collection time, filtered by registered instruments', async (t) => {
  const reader = new PeriodicMetricReader({ exporter: noopExporter(), exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  const instrumentA = { createObservation: (value, attrs) => measurement({ value, attributes: attrs }) }
  const instrumentB = { createObservation: (value, attrs) => measurement({ value, attributes: attrs }) }
  const callback = (result) => {
    result.observe(instrumentA, 1, { a: '1' })
    // Not registered for this batch -- must be dropped.
    result.observe(instrumentB, 2, { b: '2' })
  }

  reader.addBatchObservableCallback(callback, [instrumentA])
  const { resourceMetrics } = await reader.collect()
  const metric = [...resourceMetrics.metrics.values()][0]
  assert.equal(metric.dataPoints.size, 1)

  reader.removeBatchObservableCallback(callback)
  const { resourceMetrics: afterRemoval } = await reader.collect()
  assert.equal(afterRemoval.metrics.size, 0)
})

test('shutdown flushes pending metrics and shuts down the exporter', async (t) => {
  let exported = null
  let exporterShutdownCalled = false
  const exporter = {
    export(metrics, callback) { exported = metrics; callback({ code: 0 }) },
    forceFlush: () => Promise.resolve(),
    shutdown() { exporterShutdownCalled = true; return Promise.resolve() }
  }
  const reader = new PeriodicMetricReader({ exporter, exportIntervalMillis: LONG_INTERVAL })

  reader.record(measurement())
  await reader.shutdown()
  assert.ok(exported)
  assert.equal(exporterShutdownCalled, true)
})

test('can be constructed without an exporter', async (t) => {
  const reader = new PeriodicMetricReader({ exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  assert.equal(reader.exporter, undefined)
})

test('forceFlush/shutdown resolve without error when no exporter is assigned', async (t) => {
  const reader = new PeriodicMetricReader({ exportIntervalMillis: LONG_INTERVAL })

  await assert.doesNotReject(() => reader.forceFlush())
  await assert.doesNotReject(() => reader.shutdown())
})

test('collection cycles are skipped (not just export) while no exporter is assigned', async (t) => {
  const reader = new PeriodicMetricReader({ exportIntervalMillis: LONG_INTERVAL })

  // Recorded before any exporter exists. A skipped cycle must leave this
  // queued, untouched -- not drain and discard it.
  reader.record(measurement())
  await reader.forceFlush()

  let exportedMetrics = null
  reader.exporter = {
    export(metrics, callback) { exportedMetrics = metrics; callback({ code: 0 }) },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve()
  }
  await reader.forceFlush()
  assert.ok(exportedMetrics, 'export should have happened once an exporter was assigned')
  assert.equal(
    exportedMetrics.metrics.size,
    1,
    'the measurement recorded before the exporter was assigned was not lost'
  )
})

test('exporter can be assigned after construction via the setter', async (t) => {
  const reader = new PeriodicMetricReader({ exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  const exporter = noopExporter()
  reader.exporter = exporter
  assert.equal(reader.exporter, exporter)
})

test('overlapping forceFlush calls are serialized rather than racing', async (t) => {
  let concurrentExports = 0
  let maxConcurrent = 0
  const exporter = {
    async export(_metrics, callback) {
      concurrentExports += 1
      maxConcurrent = Math.max(maxConcurrent, concurrentExports)
      await new Promise((resolve) => setTimeout(resolve, 10))
      concurrentExports -= 1
      callback({ code: 0 })
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve()
  }
  const reader = new PeriodicMetricReader({ exporter, exportIntervalMillis: LONG_INTERVAL })
  t.after(() => reader.shutdown())

  await Promise.all([reader.forceFlush(), reader.forceFlush(), reader.forceFlush()])
  assert.equal(maxConcurrent, 1)
})
