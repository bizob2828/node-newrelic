/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const Meter = require('#agentlib/otel/metrics/sdk/meter.js')

function fakeMeterProvider() {
  return {
    reader: {
      observableInstruments: new Set(),
      record() {},
      addBatchObservableCallback(callback, instruments) {
        this.lastBatchAdd = { callback, instruments }
      },
      removeBatchObservableCallback(callback) {
        this.lastBatchRemove = callback
      }
    }
  }
}

test('creates and caches instruments by type and lowercase name', (t) => {
  const meter = new Meter(fakeMeterProvider(), { name: 'scope', version: '', schemaUrl: '' })

  const counter1 = meter.createCounter('My-Counter')
  const counter2 = meter.createCounter('my-counter')
  assert.equal(counter1, counter2, 'same name (case-insensitive) and type should be reused')
})

test('same name but different instrument type produces distinct instruments', (t) => {
  const meter = new Meter(fakeMeterProvider(), { name: 'scope', version: '', schemaUrl: '' })

  const counter = meter.createCounter('shared-name')
  const histogram = meter.createHistogram('shared-name')
  assert.notEqual(counter, histogram)
})

test('creates every instrument type', (t) => {
  const meter = new Meter(fakeMeterProvider(), { name: 'scope', version: '', schemaUrl: '' })

  assert.ok(meter.createCounter('a'))
  assert.ok(meter.createUpDownCounter('b'))
  assert.ok(meter.createHistogram('c'))
  assert.ok(meter.createGauge('d'))
  assert.ok(meter.createObservableCounter('e'))
  assert.ok(meter.createObservableGauge('f'))
  assert.ok(meter.createObservableUpDownCounter('g'))
})

test('addBatchObservableCallback/removeBatchObservableCallback delegate to the reader', (t) => {
  const meterProvider = fakeMeterProvider()
  const meter = new Meter(meterProvider, { name: 'scope', version: '', schemaUrl: '' })

  const callback = () => {}
  const instruments = [meter.createCounter('a')]
  meter.addBatchObservableCallback(callback, instruments)
  assert.equal(meterProvider.reader.lastBatchAdd.callback, callback)
  assert.equal(meterProvider.reader.lastBatchAdd.instruments, instruments)

  meter.removeBatchObservableCallback(callback)
  assert.equal(meterProvider.reader.lastBatchRemove, callback)
})

test('createCounter does not throw', (t) => {
  const meter = new Meter(fakeMeterProvider(), { name: 'scope', version: '', schemaUrl: '' })
  assert.doesNotThrow(() => meter.createCounter('a'))
})
