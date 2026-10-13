/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  transformResourceMetrics,
  transformAttributes,
  transformAnyValue
} = require('#agentlib/otel/metrics/otlp/metrics-transformer.js')
const { getMetricsProtobufTypes } = require('#agentlib/otel/metrics/otlp/otlp-proto-loader.js')
const { InstrumentType, AggregationTemporality } = require('#agentlib/otel/constants.js')

const SCOPE = { name: 'scope', version: '1.0.0', schemaUrl: '' }

function buildMetric({ type, temporality, isMonotonic, dataPoints, instrumentationScope = SCOPE }) {
  const metric = {
    name: 'test-metric',
    description: '',
    unit: '',
    instrumentationScope,
    type,
    temporality,
    isMonotonic,
    dataPoints: new Map()
  }
  dataPoints.forEach((dp, i) => metric.dataPoints.set(String(i), dp))
  return metric
}

test('transformAnyValue maps primitive types', (t) => {
  assert.deepEqual(transformAnyValue('hello'), { stringValue: 'hello' })
  assert.deepEqual(transformAnyValue(true), { boolValue: true })
  assert.deepEqual(transformAnyValue(42), { intValue: 42 })
  assert.deepEqual(transformAnyValue(3.14), { doubleValue: 3.14 })
  assert.deepEqual(transformAnyValue(null), {})
  assert.deepEqual(transformAnyValue(undefined), {})
})

test('transformAnyValue maps arrays, dropping null/undefined entries', (t) => {
  assert.deepEqual(transformAnyValue(['a', null, 'b', undefined]), {
    arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] }
  })
})

test('transformAttributes maps a plain object to KeyValue[], preserving order', (t) => {
  assert.deepEqual(transformAttributes({ a: '1', b: 2 }), [
    { key: 'a', value: { stringValue: '1' } },
    { key: 'b', value: { intValue: 2 } }
  ])
})

test('transformAttributes defaults to an empty array', (t) => {
  assert.deepEqual(transformAttributes(), [])
})

test('builds a Sum metric for Counter, with the correct DELTA enum value', (t) => {
  const metrics = new Map()
  metrics.set('key', buildMetric({
    type: InstrumentType.COUNTER,
    temporality: AggregationTemporality.DELTA,
    isMonotonic: true,
    dataPoints: [{ attributes: { a: '1' }, value: 5, startTimeUnixNano: 1, timeUnixNano: 2 }]
  }))

  const result = transformResourceMetrics({ resource: { attributes: {} }, metrics })
  const metric = result.scopeMetrics[0].metrics[0]
  assert.ok(metric.sum)
  assert.equal(metric.sum.isMonotonic, true)
  assert.equal(metric.sum.dataPoints[0].asInt, 5)

  const { AggregationTemporality: ProtoTemporality } = getMetricsProtobufTypes()
  assert.equal(metric.sum.aggregationTemporality, ProtoTemporality.AGGREGATION_TEMPORALITY_DELTA)
})

test('builds a Sum metric with the correct CUMULATIVE enum value for UpDownCounter', (t) => {
  const metrics = new Map()
  metrics.set('key', buildMetric({
    type: InstrumentType.UP_DOWN_COUNTER,
    temporality: AggregationTemporality.CUMULATIVE,
    isMonotonic: false,
    dataPoints: [{ attributes: {}, value: 2.5, startTimeUnixNano: 1, timeUnixNano: 2 }]
  }))

  const result = transformResourceMetrics({ resource: { attributes: {} }, metrics })
  const metric = result.scopeMetrics[0].metrics[0]
  assert.equal(metric.sum.isMonotonic, false)
  assert.equal(metric.sum.dataPoints[0].asDouble, 2.5)

  const { AggregationTemporality: ProtoTemporality } = getMetricsProtobufTypes()
  assert.equal(metric.sum.aggregationTemporality, ProtoTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE)
})

test('builds a Histogram metric, omitting min/max when absent', (t) => {
  const metrics = new Map()
  metrics.set('key', buildMetric({
    type: InstrumentType.HISTOGRAM,
    temporality: AggregationTemporality.DELTA,
    isMonotonic: false,
    dataPoints: [{
      attributes: {},
      count: 2,
      sum: 10,
      bucketCounts: [1, 1],
      explicitBounds: [5],
      startTimeUnixNano: 1,
      timeUnixNano: 2
    }]
  }))

  const result = transformResourceMetrics({ resource: { attributes: {} }, metrics })
  const dataPoint = result.scopeMetrics[0].metrics[0].histogram.dataPoints[0]
  assert.equal('min' in dataPoint, false)
  assert.equal('max' in dataPoint, false)
  assert.equal(dataPoint.count, 2)
  assert.equal(dataPoint.sum, 10)
})

test('builds a Histogram metric, including min/max when present', (t) => {
  const metrics = new Map()
  metrics.set('key', buildMetric({
    type: InstrumentType.HISTOGRAM,
    temporality: AggregationTemporality.CUMULATIVE,
    isMonotonic: false,
    dataPoints: [{
      attributes: {},
      count: 2,
      sum: 10,
      min: 1,
      max: 9,
      bucketCounts: [1, 1],
      explicitBounds: [5],
      startTimeUnixNano: 1,
      timeUnixNano: 2
    }]
  }))

  const result = transformResourceMetrics({ resource: { attributes: {} }, metrics })
  const dataPoint = result.scopeMetrics[0].metrics[0].histogram.dataPoints[0]
  assert.equal(dataPoint.min, 1)
  assert.equal(dataPoint.max, 9)
})

test('builds a Gauge metric with no aggregation temporality field', (t) => {
  const metrics = new Map()
  metrics.set('key', buildMetric({
    type: InstrumentType.GAUGE,
    temporality: undefined,
    isMonotonic: undefined,
    dataPoints: [{ attributes: {}, value: 3.5, timeUnixNano: 2 }]
  }))

  const result = transformResourceMetrics({ resource: { attributes: {} }, metrics })
  const metric = result.scopeMetrics[0].metrics[0]
  assert.ok(metric.gauge)
  assert.equal('aggregationTemporality' in metric.gauge, false)
  assert.equal(metric.gauge.dataPoints[0].asDouble, 3.5)
})

test('groups metrics by instrumentation scope', (t) => {
  const scopeA = { name: 'a', version: '', schemaUrl: '' }
  const scopeB = { name: 'b', version: '', schemaUrl: '' }
  const dataPoints = [{ attributes: {}, value: 1, startTimeUnixNano: 1, timeUnixNano: 2 }]

  const metrics = new Map([
    ['a', buildMetric({
      type: InstrumentType.COUNTER,
      temporality: AggregationTemporality.DELTA,
      isMonotonic: true,
      dataPoints,
      instrumentationScope: scopeA
    })],
    ['b', buildMetric({
      type: InstrumentType.COUNTER,
      temporality: AggregationTemporality.DELTA,
      isMonotonic: true,
      dataPoints,
      instrumentationScope: scopeB
    })]
  ])

  const result = transformResourceMetrics({ resource: { attributes: {} }, metrics })
  assert.equal(result.scopeMetrics.length, 2)
})

test('resource attributes are mapped and droppedAttributesCount is 0', (t) => {
  const result = transformResourceMetrics({
    resource: { attributes: { 'entity.guid': 'abc' } },
    metrics: new Map()
  })
  assert.deepEqual(result.resource.attributes, [{ key: 'entity.guid', value: { stringValue: 'abc' } }])
  assert.equal(result.resource.droppedAttributesCount, 0)
})
