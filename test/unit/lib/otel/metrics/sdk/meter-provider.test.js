/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const MeterProvider = require('#agentlib/otel/metrics/sdk/meter-provider.js')

function fakeReader() {
  return {
    shutdownCalled: false,
    shutdown() {
      this.shutdownCalled = true
      return Promise.resolve()
    }
  }
}

function fakeAgent() {
  const recorded = []
  return {
    recorded,
    metrics: {
      getOrCreateMetric(name) {
        recorded.push(name)
        return { incrementCallCount() {} }
      }
    }
  }
}

test('getMeter caches by name@version@schemaUrl', (t) => {
  const provider = new MeterProvider({ reader: fakeReader() })

  const a = provider.getMeter('scope-a')
  const b = provider.getMeter('scope-a')
  assert.equal(a, b)

  const c = provider.getMeter('scope-a', '1.0.0')
  assert.notEqual(a, c)

  const d = provider.getMeter('scope-a', '1.0.0', { schemaUrl: 'https://example.com' })
  assert.notEqual(c, d)
})

test('resource getter/setter forward to the reader', (t) => {
  const reader = fakeReader()
  const provider = new MeterProvider({ reader, resource: { attributes: { a: '1' } } })

  assert.deepEqual(provider.resource, { attributes: { a: '1' } })
  assert.equal(reader.resource, provider.resource)

  provider.resource = { attributes: { b: '2' } }
  assert.deepEqual(reader.resource, { attributes: { b: '2' } })
})

test('constructor works without an initial resource', (t) => {
  const reader = fakeReader()
  assert.doesNotThrow(() => new MeterProvider({ reader }))
})

test('shutdown delegates to the reader', async (t) => {
  const reader = fakeReader()
  const provider = new MeterProvider({ reader })

  await provider.shutdown()
  assert.equal(reader.shutdownCalled, true)
})

test('tracks every getMeter call as a Supportability metric when an agent is provided', (t) => {
  const agent = fakeAgent()
  const provider = new MeterProvider({ reader: fakeReader(), agent })

  provider.getMeter('scope-a')
  provider.getMeter('scope-a') // cache hit -- still tracked on every call

  assert.deepEqual(agent.recorded, [
    'Supportability/Metrics/Nodejs/OpenTelemetryBridge/getMeter',
    'Supportability/Metrics/Nodejs/OpenTelemetryBridge/getMeter'
  ])
})

test('passes the agent through to meters it creates', (t) => {
  const agent = fakeAgent()
  const provider = new MeterProvider({ reader: fakeReader(), agent })

  provider.getMeter('scope-a').createCounter('my-counter')

  assert.deepEqual(agent.recorded, [
    'Supportability/Metrics/Nodejs/OpenTelemetryBridge/getMeter',
    'Supportability/Metrics/Nodejs/OpenTelemetryBridge/meter/createCounter'
  ])
})

test('does not throw when no agent is provided', (t) => {
  const provider = new MeterProvider({ reader: fakeReader() })
  assert.doesNotThrow(() => provider.getMeter('scope-a'))
})
