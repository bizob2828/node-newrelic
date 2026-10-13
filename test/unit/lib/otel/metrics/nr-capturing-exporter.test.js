/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { ExportResultCode } = require('#agentlib/otel/constants.js')
const PeriodicMetricReader = require('#agentlib/otel/metrics/sdk/periodic-metric-reader.js')
const MeterProvider = require('#agentlib/otel/metrics/sdk/meter-provider.js')
const { getMetricsProtobufTypes } = require('#agentlib/otel/metrics/otlp/otlp-proto-loader.js')

const NRCapturingExporter = require('#agentlib/otel/metrics/nr-capturing-exporter.js')

test.beforeEach((ctx) => {
  ctx.nr = {
    logs: []
  }

  ctx.nr.logger = {
    audit(...args) { ctx.nr.logs.push(args) },
    child() { return this }
  }

  ctx.nr.exporter = new NRCapturingExporter({ logger: ctx.nr.logger })

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

/**
 * Collects a real `ResourceMetrics` object carrying a single incremented
 * counter so tests can exercise the exporter with genuine data.
 *
 * @param {object} ctx The test context holding the reader/meter provider.
 * @returns {Promise<object>} The collected `ResourceMetrics`.
 */
async function collect(ctx) {
  ctx.nr.meterProvider
    .getMeter('test-meter')
    .createCounter('test-counter')
    .add(1, { foo: 'bar' })
  const { resourceMetrics } = await ctx.nr.reader.collect()
  return resourceMetrics
}

test('export serializes the metrics and reports success', async (t) => {
  const { exporter } = t.nr
  const metrics = await collect(t)

  let result = null
  exporter.export(metrics, (r) => { result = r })
  assert.deepEqual(result, { code: ExportResultCode.SUCCESS })

  const { ExportMetricsServiceRequest } = getMetricsProtobufTypes()
  const decoded = ExportMetricsServiceRequest.decode(
    Buffer.from(exporter.lastSerialization, 'base64')
  )
  const metric = decoded.resourceMetrics[0].scopeMetrics[0].metrics[0]
  assert.equal(metric.name, 'test-counter')
  assert.equal(metric.sum.dataPoints[0].attributes[0].key, 'foo')
  assert.deepEqual(metric.sum.dataPoints[0].attributes[0].value, { stringValue: 'bar' })
})

test('export writes an audit log of the serialized payload', async (t) => {
  const { exporter } = t.nr
  const metrics = await collect(t)

  exporter.export(metrics, () => {})

  assert.equal(t.nr.logs.length, 1)
  const [logged] = t.nr.logs
  assert.deepEqual(logged[1], 'Serialized metrics data.')
  assert.equal(logged[0].destUrl, 'local capture')
  assert.equal(logged[0].bytes, Buffer.from(logged[0].data, 'base64').byteLength)
})

test('lastSerialization purges the cache on read', async (t) => {
  const { exporter } = t.nr
  const metrics = await collect(t)

  exporter.export(metrics, () => {})

  assert.notEqual(exporter.lastSerialization, '')
  assert.equal(exporter.lastSerialization, '')
})

test('forceFlush and shutdown resolve without error', async (t) => {
  const { exporter } = t.nr
  await assert.doesNotReject(() => exporter.forceFlush())
  await assert.doesNotReject(() => exporter.shutdown())
})
