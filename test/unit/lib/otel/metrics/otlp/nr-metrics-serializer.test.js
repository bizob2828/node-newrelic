/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { NrMetricsSerializer } = require('#agentlib/otel/metrics/otlp/nr-metrics-serializer.js')
const { getMetricsProtobufTypes } = require('#agentlib/otel/metrics/otlp/otlp-proto-loader.js')
const { InstrumentType, AggregationTemporality } = require('#agentlib/otel/constants.js')

const SCOPE = { name: 'scope', version: '', schemaUrl: '' }

function buildResourceMetrics() {
  const metric = {
    name: 'test-counter',
    description: '',
    unit: '',
    instrumentationScope: SCOPE,
    type: InstrumentType.COUNTER,
    temporality: AggregationTemporality.DELTA,
    isMonotonic: true,
    dataPoints: new Map([
      ['k', { attributes: { foo: 'bar' }, value: 5, startTimeUnixNano: 1, timeUnixNano: 2 }]
    ])
  }
  return { resource: { attributes: { 'entity.guid': 'abc' } }, metrics: new Map([['test-counter', metric]]) }
}

test('serializeRequest produces bytes decodable as ExportMetricsServiceRequest', (t) => {
  const serialized = NrMetricsSerializer.serializeRequest(buildResourceMetrics())
  const { ExportMetricsServiceRequest } = getMetricsProtobufTypes()
  const decoded = ExportMetricsServiceRequest.decode(serialized)

  assert.equal(decoded.resourceMetrics[0].resource.attributes[0].key, 'entity.guid')
  const metric = decoded.resourceMetrics[0].scopeMetrics[0].metrics[0]
  assert.equal(metric.name, 'test-counter')
  assert.equal(metric.sum.dataPoints[0].attributes[0].key, 'foo')
  // `as_int` is sfixed64, decoded by protobufjs as a `Long`, not a plain number.
  assert.equal(metric.sum.dataPoints[0].asInt.toString(), '5')
})

test('deserializeResponse decodes a real ExportMetricsServiceResponse buffer', (t) => {
  const { ExportMetricsServiceResponse } = getMetricsProtobufTypes()
  const encoded = ExportMetricsServiceResponse.encode(
    ExportMetricsServiceResponse.create({
      partialSuccess: { rejectedDataPoints: 2, errorMessage: 'oops' }
    })
  ).finish()

  const decoded = NrMetricsSerializer.deserializeResponse(encoded)
  assert.equal(decoded.partialSuccess.errorMessage, 'oops')
  assert.equal(decoded.partialSuccess.rejectedDataPoints.toString(), '2')
})

test('deserializeResponse handles an empty response', (t) => {
  const { ExportMetricsServiceResponse } = getMetricsProtobufTypes()
  const encoded = ExportMetricsServiceResponse.encode(ExportMetricsServiceResponse.create({})).finish()
  const decoded = NrMetricsSerializer.deserializeResponse(encoded)
  assert.ok(decoded)
})
