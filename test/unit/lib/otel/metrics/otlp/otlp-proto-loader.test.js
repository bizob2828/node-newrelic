/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const {
  getMetricsProtobufTypes,
  PROTO_DIR
} = require('#agentlib/otel/metrics/otlp/otlp-proto-loader.js')

test('PROTO_DIR points to a directory containing the vendored proto files', (t) => {
  assert.equal(fs.statSync(PROTO_DIR).isDirectory(), true)
  const metricsServicePath = path.join(
    PROTO_DIR,
    'opentelemetry/proto/collector/metrics/v1/metrics_service.proto'
  )
  assert.equal(fs.existsSync(metricsServicePath), true)
})

test('resolves ExportMetricsServiceRequest and ExportMetricsServiceResponse message types', (t) => {
  const { ExportMetricsServiceRequest, ExportMetricsServiceResponse } = getMetricsProtobufTypes()

  // Round-trip encode/decode to confirm these are real, usable protobufjs
  // Type objects driven by the loaded schema, not just truthy values.
  const encoded = ExportMetricsServiceRequest.encode(
    ExportMetricsServiceRequest.create({ resourceMetrics: [] })
  ).finish()
  const decoded = ExportMetricsServiceRequest.decode(encoded)
  assert.deepEqual(decoded.resourceMetrics, [])

  const encodedResponse = ExportMetricsServiceResponse.encode(
    ExportMetricsServiceResponse.create({})
  ).finish()
  assert.doesNotThrow(() => ExportMetricsServiceResponse.decode(encodedResponse))
})

test('resolves the AggregationTemporality enum with the real OTLP values', (t) => {
  const { AggregationTemporality } = getMetricsProtobufTypes()
  assert.deepEqual(AggregationTemporality, {
    AGGREGATION_TEMPORALITY_UNSPECIFIED: 0,
    AGGREGATION_TEMPORALITY_DELTA: 1,
    AGGREGATION_TEMPORALITY_CUMULATIVE: 2
  })
})

test('caches and returns the same object on repeated calls', (t) => {
  const first = getMetricsProtobufTypes()
  const second = getMetricsProtobufTypes()
  assert.equal(first, second)
  assert.equal(first.ExportMetricsServiceRequest, second.ExportMetricsServiceRequest)
})
