/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { aggregate, DEFAULT_HISTOGRAM_BUCKETS } = require('#agentlib/otel/metrics/sdk/metric-aggregator.js')
const { InstrumentType, AggregationTemporality } = require('#agentlib/otel/constants.js')

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

function firstDataPoint(metrics) {
  return [...metrics.values()][0].dataPoints.values().next().value
}

test('counter sum accumulates across cycles and reports delta', (t) => {
  const cumulativeState = new Map()
  const lastExportedState = new Map()

  let metrics = aggregate([measurement({ value: 3 })], cumulativeState, lastExportedState)
  assert.equal(firstDataPoint(metrics).value, 3)

  metrics = aggregate(
    [measurement({ value: 2 }), measurement({ value: 4 })],
    cumulativeState,
    lastExportedState
  )
  assert.equal(firstDataPoint(metrics).value, 6)
})

test('up-down counter reports cumulative value, never delta-converted', (t) => {
  const cumulativeState = new Map()
  const lastExportedState = new Map()

  let metrics = aggregate(
    [measurement({ type: InstrumentType.UP_DOWN_COUNTER, value: 5 })],
    cumulativeState,
    lastExportedState
  )
  assert.equal(firstDataPoint(metrics).value, 5)

  metrics = aggregate(
    [measurement({ type: InstrumentType.UP_DOWN_COUNTER, value: -2 })],
    cumulativeState,
    lastExportedState
  )
  assert.equal(firstDataPoint(metrics).value, 3)
})

test('observable counter overwrites cumulative state with the reported absolute value', (t) => {
  const cumulativeState = new Map()
  const lastExportedState = new Map()

  let metrics = aggregate(
    [measurement({ type: InstrumentType.OBSERVABLE_COUNTER, value: 10 })],
    cumulativeState,
    lastExportedState
  )
  assert.equal(firstDataPoint(metrics).value, 10)

  metrics = aggregate(
    [measurement({ type: InstrumentType.OBSERVABLE_COUNTER, value: 15 })],
    cumulativeState,
    lastExportedState
  )
  assert.equal(firstDataPoint(metrics).value, 5)
})

test('gauge is pure last-value with no temporality and no persisted state', (t) => {
  const cumulativeState = new Map()
  const lastExportedState = new Map()

  const metrics = aggregate(
    [
      measurement({ type: InstrumentType.GAUGE, value: 1 }),
      measurement({ type: InstrumentType.GAUGE, value: 2 })
    ],
    cumulativeState,
    lastExportedState
  )
  const metric = [...metrics.values()][0]
  assert.equal(metric.temporality, undefined)
  assert.equal(firstDataPoint(metrics).value, 2)
  assert.equal(cumulativeState.size, 0)
})

test('histogram buckets values and tracks count/sum/bucketCounts', (t) => {
  // Histograms are always DELTA temporality in this bridge, so min/max are
  // always stripped by the time `aggregate()` returns -- see the dedicated
  // omission test below. Count/sum/bucketCounts survive (delta-converted
  // via subtraction, not deleted).
  const metrics = aggregate(
    [
      measurement({ type: InstrumentType.HISTOGRAM, value: 3 }),
      measurement({ type: InstrumentType.HISTOGRAM, value: 20_000 })
    ],
    new Map(),
    new Map()
  )
  const dp = firstDataPoint(metrics)
  assert.equal(dp.count, 2)
  assert.equal(dp.sum, 20_003)
  assert.equal(dp.bucketCounts.length, DEFAULT_HISTOGRAM_BUCKETS.length + 1)
  assert.equal(dp.bucketCounts[1], 1, 'value 3 falls in the <=5 bucket')
  assert.equal(dp.bucketCounts.at(-1), 1, 'value 20000 overflows past the last bound')
})

test('delta histogram data points omit min/max', (t) => {
  const metrics = aggregate(
    [measurement({ type: InstrumentType.HISTOGRAM, value: 5 })],
    new Map(),
    new Map()
  )
  const dp = firstDataPoint(metrics)
  assert.equal('min' in dp, false)
  assert.equal('max' in dp, false)
})

test('delta histogram subtracts cumulative count/sum/bucketCounts across cycles', (t) => {
  const cumulativeState = new Map()
  const lastExportedState = new Map()

  let metrics = aggregate(
    [measurement({ type: InstrumentType.HISTOGRAM, value: 5 })],
    cumulativeState,
    lastExportedState
  )
  let dp = firstDataPoint(metrics)
  assert.equal(dp.count, 1)
  assert.equal(dp.sum, 5)

  metrics = aggregate(
    [measurement({ type: InstrumentType.HISTOGRAM, value: 7 })],
    cumulativeState,
    lastExportedState
  )
  dp = firstDataPoint(metrics)
  assert.equal(dp.count, 1)
  assert.equal(dp.sum, 7)
})

test('isMonotonic is true only for Counter/ObservableCounter', (t) => {
  const check = (type, expected) => {
    const metrics = aggregate([measurement({ type })], new Map(), new Map())
    assert.equal([...metrics.values()][0].isMonotonic, expected)
  }
  check(InstrumentType.COUNTER, true)
  check(InstrumentType.OBSERVABLE_COUNTER, true)
  check(InstrumentType.UP_DOWN_COUNTER, false)
  check(InstrumentType.OBSERVABLE_UP_DOWN_COUNTER, false)
})

test('temporality matches the expected per-type table', (t) => {
  const check = (type, expected) => {
    const metrics = aggregate([measurement({ type })], new Map(), new Map())
    assert.equal([...metrics.values()][0].temporality, expected)
  }
  check(InstrumentType.COUNTER, AggregationTemporality.DELTA)
  check(InstrumentType.OBSERVABLE_COUNTER, AggregationTemporality.DELTA)
  check(InstrumentType.HISTOGRAM, AggregationTemporality.DELTA)
  check(InstrumentType.UP_DOWN_COUNTER, AggregationTemporality.CUMULATIVE)
  check(InstrumentType.OBSERVABLE_UP_DOWN_COUNTER, AggregationTemporality.CUMULATIVE)
  check(InstrumentType.GAUGE, undefined)
  check(InstrumentType.OBSERVABLE_GAUGE, undefined)
})

test('different attribute sets produce distinct data points on the same metric', (t) => {
  const metrics = aggregate(
    [measurement({ attributes: { a: '1' } }), measurement({ attributes: { a: '2' } })],
    new Map(),
    new Map()
  )
  const metric = [...metrics.values()][0]
  assert.equal(metric.dataPoints.size, 2)
})
