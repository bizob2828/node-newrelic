/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const NRCapturingExporter = require('#agentlib/otel/metrics/nr-capturing-exporter.js')
const NrMeterProvider = require('#agentlib/otel/metrics/nr-meter-provider.js')
const NrJsonSerializer = new (require('#agentlib/otel/metrics/nr-json-serializer.js'))()

test.beforeEach((ctx) => {
  ctx.nr = { logs: [] }
  ctx.nr.logger = {
    audit(...args) { ctx.nr.logs.push(args) },
    auditEnabled() { return true },
    child() { return this }
  }
  ctx.nr.exporter = new NRCapturingExporter({ logger: ctx.nr.logger })
  ctx.nr.provider = new NrMeterProvider()
})

/**
 * Records a counter increment and collects the resulting NrResourceMetrics.
 *
 * @param {object} ctx Test context holding the meter provider.
 * @returns {Promise<object>} Collected ResourceMetrics.
 */
async function collect(ctx) {
  ctx.nr.provider.getMeter('test-meter').createCounter('test-counter').add(1, { foo: 'bar' })
  const { resourceMetrics } = await ctx.nr.provider.collect()
  return resourceMetrics
}

test('export serializes the metrics and reports success', async (t) => {
  const { exporter } = t.nr
  const metrics = await collect(t)

  let result = null
  exporter.export(metrics, (r) => { result = r })
  assert.deepEqual(result, { code: 0 })

  const expected = Buffer.from(NrJsonSerializer.serializeRequest(metrics), 'utf8').toString('base64')
  assert.equal(exporter.lastSerialization, expected)
})

test('export writes an audit log of the serialized payload', async (t) => {
  const { exporter } = t.nr
  const metrics = await collect(t)

  exporter.export(metrics, () => {})

  const serialized = NrJsonSerializer.serializeRequest(metrics)
  const expected = Buffer.from(serialized, 'utf8').toString('base64')

  assert.equal(t.nr.logs.length, 1)
  assert.deepEqual(t.nr.logs[0], [
    {
      destUrl: 'local capture',
      data: expected,
      bytes: Buffer.from(serialized, 'utf8').byteLength
    },
    'Serialized metrics data.'
  ])
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
