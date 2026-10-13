/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const PeriodicMetricReader = require('#agentlib/otel/metrics/sdk/periodic-metric-reader.js')
const MeterProvider = require('#agentlib/otel/metrics/sdk/meter-provider.js')
const { NrMetricsSerializer } = require('#agentlib/otel/metrics/otlp/nr-metrics-serializer.js')
const { getMetricsProtobufTypes } = require('#agentlib/otel/metrics/otlp/otlp-proto-loader.js')
const { ExportResultCode } = require('#agentlib/otel/constants.js')
const NRProxyingSerializer = require('#agentlib/otel/metrics/nr-proxying-serializer.js')

test.beforeEach((ctx) => {
  ctx.nr = {
    logs: []
  }

  ctx.nr.logger = {
    auditEnabled() { return true },
    audit(...args) { ctx.nr.logs.push(args) },
    child() { return this }
  }

  ctx.nr.serializer = new NRProxyingSerializer({
    destinationUrl: 'http://example.com:1234/v1/metrics',
    logger: ctx.nr.logger
  })
  ctx.nr.reader = new PeriodicMetricReader({
    exporter: {
      export: (_metrics, callback) => callback({ code: ExportResultCode.SUCCESS }),
      forceFlush: () => Promise.resolve(),
      shutdown: () => Promise.resolve()
    },
    exportIntervalMillis: 100
  })
  ctx.nr.meterProvider = new MeterProvider({ reader: ctx.nr.reader })
})

test.afterEach(async (ctx) => {
  await ctx.nr.meterProvider.shutdown()
})

test('logs when serializing', async (t) => {
  const { meterProvider, reader, serializer } = t.nr
  const meter = meterProvider.getMeter('test-meter')
  const counter = meter.createCounter('test-counter')
  counter.add(1, { foo: 'bar' })

  const collected = await reader.collect()
  const input = collected.resourceMetrics
  const expected = NrMetricsSerializer.serializeRequest(input)
  const found = serializer.serializeRequest(input)

  assert.equal(Buffer.compare(found, expected), 0)
  const buffer = Buffer.from(found)
  assert.deepEqual(
    t.nr.logs[0],
    [
      {
        destUrl: 'http://example.com:1234/v1/metrics',
        data: buffer.toString('base64'),
        bytes: buffer.byteLength
      },
      'Serialized metrics data.'
    ]
  )
})

test('logs when deserializing', async (t) => {
  const { serializer } = t.nr

  // Use a real, correctly-shaped `ExportMetricsServiceResponse` buffer --
  // not an `ExportMetricsServiceRequest` buffer, which happens to decode
  // under the response schema in some cases but is not a valid response.
  const { ExportMetricsServiceResponse } = getMetricsProtobufTypes()
  const input = ExportMetricsServiceResponse.encode(
    ExportMetricsServiceResponse.create({
      partialSuccess: { rejectedDataPoints: 1, errorMessage: 'partial' }
    })
  ).finish()

  const expected = NrMetricsSerializer.deserializeResponse(input)
  const found = serializer.deserializeResponse(input)

  assert.deepEqual(found, expected)

  const buffer = Buffer.from(input)
  assert.deepEqual(
    t.nr.logs[0],
    [
      {
        data: buffer.toString('base64')
      },
      'Received response data.'
    ]
  )
})

test('does not log when audit logging is disabled', async (t) => {
  const { meterProvider, reader, serializer } = t.nr
  t.nr.logger.auditEnabled = () => false
  const meter = meterProvider.getMeter('test-meter')
  const counter = meter.createCounter('test-counter')
  counter.add(1, { foo: 'bar' })

  const collected = await reader.collect()
  const input = collected.resourceMetrics
  const expected = NrMetricsSerializer.serializeRequest(input)
  const found = serializer.serializeRequest(input)

  assert.equal(Buffer.compare(found, expected), 0)
  assert.deepEqual(t.nr.logs, [])
})
