/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { InstrumentType } = require('#agentlib/otel/constants.js')
const {
  Counter,
  UpDownCounter,
  Histogram,
  Gauge,
  ObservableCounter
} = require('#agentlib/otel/metrics/sdk/instruments.js')

function fakeReader() {
  return {
    recorded: [],
    observableInstruments: new Set(),
    record(measurement) {
      this.recorded.push(measurement)
    }
  }
}

const SCOPE = { name: 'test-scope', version: '1.0.0', schemaUrl: '' }

test('Counter.add records a measurement', (t) => {
  const reader = fakeReader()
  const counter = new Counter('my-counter', { description: 'd', unit: 'u' }, SCOPE, reader)
  counter.add(5, { foo: 'bar' })

  assert.equal(reader.recorded.length, 1)
  const [measurement] = reader.recorded
  assert.equal(measurement.name, 'my-counter')
  assert.equal(measurement.description, 'd')
  assert.equal(measurement.unit, 'u')
  assert.equal(measurement.type, InstrumentType.COUNTER)
  assert.equal(measurement.value, 5)
  assert.deepEqual(measurement.attributes, { foo: 'bar' })
  assert.equal(measurement.instrumentationScope, SCOPE)
  assert.equal(typeof measurement.timestamp, 'number')
})

test('Counter.add silently drops negative values', (t) => {
  const reader = fakeReader()
  const counter = new Counter('my-counter', {}, SCOPE, reader)
  counter.add(-1)
  assert.equal(reader.recorded.length, 0)
})

test('UpDownCounter.add allows negative values', (t) => {
  const reader = fakeReader()
  const counter = new UpDownCounter('my-updown', {}, SCOPE, reader)
  counter.add(-5)
  assert.equal(reader.recorded.length, 1)
  assert.equal(reader.recorded[0].value, -5)
  assert.equal(reader.recorded[0].type, InstrumentType.UP_DOWN_COUNTER)
})

test('Histogram.record silently drops negative values', (t) => {
  const reader = fakeReader()
  const histogram = new Histogram('my-histogram', {}, SCOPE, reader)
  histogram.record(-1)
  histogram.record(10)
  assert.equal(reader.recorded.length, 1)
  assert.equal(reader.recorded[0].value, 10)
  assert.equal(reader.recorded[0].type, InstrumentType.HISTOGRAM)
})

test('Gauge.record allows negative values', (t) => {
  const reader = fakeReader()
  const gauge = new Gauge('my-gauge', {}, SCOPE, reader)
  gauge.record(-3.5)
  assert.equal(reader.recorded.length, 1)
  assert.equal(reader.recorded[0].value, -3.5)
  assert.equal(reader.recorded[0].type, InstrumentType.GAUGE)
})

test('attributes are sanitized: invalid keys/values are dropped', (t) => {
  const reader = fakeReader()
  const counter = new Counter('my-counter', {}, SCOPE, reader)
  counter.add(1, {
    valid: 'yes',
    '': 'empty key dropped',
    bad: { nested: 'object dropped' },
    mixed: ['a', 1],
    nullable: null
  })
  assert.deepEqual(reader.recorded[0].attributes, {
    valid: 'yes',
    nullable: null
  })
})

test('ObservableCounter registers and deregisters with the reader', (t) => {
  const reader = fakeReader()
  const observable = new ObservableCounter('obs-counter', {}, SCOPE, reader)
  const callback = () => {}

  observable.addCallback(callback)
  assert.equal(reader.observableInstruments.has(observable), true)

  observable.removeCallback(callback)
  assert.equal(reader.observableInstruments.has(observable), false)
})

test('ObservableCounter.collect invokes callbacks and swallows exceptions', (t) => {
  const reader = fakeReader()
  const observable = new ObservableCounter('obs-counter', {}, SCOPE, reader)

  observable.addCallback((result) => {
    result.observe(10, { a: '1' })
  })
  observable.addCallback(() => {
    throw new Error('boom')
  })
  observable.addCallback((result) => {
    result.observe(20, { a: '2' })
  })

  const observations = observable.collect()
  assert.equal(observations.length, 2)
  assert.equal(observations[0].value, 10)
  assert.equal(observations[0].type, InstrumentType.OBSERVABLE_COUNTER)
  assert.equal(observations[1].value, 20)
})

test('createObservation builds a measurement of the instrument\'s own type', (t) => {
  const reader = fakeReader()
  const observable = new ObservableCounter('obs-counter', {}, SCOPE, reader)
  const observation = observable.createObservation(7, { x: 'y' })
  assert.equal(observation.type, InstrumentType.OBSERVABLE_COUNTER)
  assert.equal(observation.value, 7)
  assert.deepEqual(observation.attributes, { x: 'y' })
})
