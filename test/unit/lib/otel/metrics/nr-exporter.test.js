/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const {
  MeterProvider,
  PeriodicExportingMetricReader
} = require('@opentelemetry/sdk-metrics')
const { ProtobufMetricsSerializer } = require('@opentelemetry/otlp-transformer')
const { ExportResultCode } = require('#agentlib/otel/constants.js')
const NROTLPMetricExporter = require('#agentlib/otel/metrics/nr-exporter.js')

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function urlFor(server) {
  const { port } = server.address()
  return `http://127.0.0.1:${port}/v1/metrics`
}

async function collectSampleMetrics() {
  const reader = new PeriodicExportingMetricReader({
    exporter: { export() {}, forceFlush: () => Promise.resolve(), shutdown: () => Promise.resolve() },
    exportIntervalMillis: 100
  })
  const provider = new MeterProvider({ readers: [reader] })
  provider.getMeter('test-meter').createCounter('test-counter').add(1, { foo: 'bar' })
  const { resourceMetrics } = await reader.collect()
  await provider.shutdown()
  return resourceMetrics
}

test.beforeEach((ctx) => {
  ctx.nr = {
    metricsRecorded: []
  }
  ctx.nr.logger = {
    auditEnabled() { return false },
    audit() {},
    child() { return this }
  }
  ctx.nr.agent = {
    metrics: {
      getOrCreateMetric(name) {
        ctx.nr.metricsRecorded.push(name)
        return { incrementCallCount() {} }
      }
    }
  }
})

test.afterEach((ctx) => {
  ctx.nr.server?.close()
})

test('posts serialized metrics and reports success', async (t) => {
  const { agent, logger } = t.nr
  let receivedHeaders = null
  let receivedBody = null

  t.nr.server = await startServer((req, res) => {
    receivedHeaders = req.headers
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks)
      res.writeHead(200)
      res.end()
    })
  })

  const exporter = new NROTLPMetricExporter(
    // Local test server is plain HTTP; the default `keepAliveAgent` is a
    // `https.Agent`, which would try (and fail) to speak TLS to it.
    { url: urlFor(t.nr.server), headers: { 'api-key': 'test-key' }, httpAgentOptions: () => undefined },
    { agent, logger }
  )

  const resourceMetrics = await collectSampleMetrics()
  const expectedBody = ProtobufMetricsSerializer.serializeRequest(resourceMetrics)

  await new Promise((resolve) => {
    exporter.export(resourceMetrics, (result) => {
      assert.equal(result.code, ExportResultCode.SUCCESS)
      resolve()
    })
  })

  assert.equal(receivedHeaders['api-key'], 'test-key')
  assert.equal(receivedHeaders['content-type'], 'application/x-protobuf')
  assert.equal(Buffer.compare(receivedBody, Buffer.from(expectedBody)), 0)
  assert.deepEqual(t.nr.metricsRecorded, [
    'Supportability/Metrics/Nodejs/OpenTelemetryBridge/export/success'
  ])
})

test('reports failure when the destination errors', async (t) => {
  const { agent, logger } = t.nr

  t.nr.server = await startServer((req, res) => {
    res.writeHead(400)
    res.end('nope')
  })

  const exporter = new NROTLPMetricExporter(
    // Local test server is plain HTTP; the default `keepAliveAgent` is a
    // `https.Agent`, which would try (and fail) to speak TLS to it.
    { url: urlFor(t.nr.server), headers: { 'api-key': 'test-key' }, httpAgentOptions: () => undefined },
    { agent, logger }
  )

  const resourceMetrics = await collectSampleMetrics()

  await new Promise((resolve) => {
    exporter.export(resourceMetrics, (result) => {
      assert.equal(result.code, ExportResultCode.FAILED)
      resolve()
    })
  })

  assert.deepEqual(t.nr.metricsRecorded, [
    'Supportability/Metrics/Nodejs/OpenTelemetryBridge/export/failure'
  ])
})

test('selectAggregation and selectAggregationTemporality use the agent defaults', async (t) => {
  const { AggregationTemporality, AggregationType, InstrumentType } = require('@opentelemetry/sdk-metrics')
  const { agent, logger } = t.nr
  t.nr.server = await startServer((req, res) => { res.writeHead(200); res.end() })

  const exporter = new NROTLPMetricExporter(
    { url: urlFor(t.nr.server) },
    { agent, logger }
  )

  assert.deepEqual(exporter.selectAggregation(InstrumentType.COUNTER), { type: AggregationType.DEFAULT })
  assert.equal(exporter.selectAggregationTemporality(InstrumentType.COUNTER), AggregationTemporality.DELTA)
  assert.equal(
    exporter.selectAggregationTemporality(InstrumentType.UP_DOWN_COUNTER),
    AggregationTemporality.CUMULATIVE
  )
})

test('forceFlush and shutdown resolve', async (t) => {
  const { agent, logger } = t.nr
  t.nr.server = await startServer((req, res) => { res.writeHead(200); res.end() })

  const exporter = new NROTLPMetricExporter(
    { url: urlFor(t.nr.server) },
    { agent, logger }
  )

  await assert.doesNotReject(() => exporter.forceFlush())
  await assert.doesNotReject(() => exporter.shutdown())
})
