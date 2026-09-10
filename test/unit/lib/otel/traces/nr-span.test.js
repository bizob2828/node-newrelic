/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { NrSpan } = require('#agentlib/otel/traces/nr-span.js')
const { ATTR_VALUE_LENGTH_LIMIT } = require('#agentlib/otel/constants.js')

const OVER_LIMIT = 'x'.repeat(ATTR_VALUE_LENGTH_LIMIT + 1)
const AT_LIMIT = 'x'.repeat(ATTR_VALUE_LENGTH_LIMIT)

function makeSpanContext() {
  return { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 }
}

function makeProcessor() {
  const calls = { onStart: [], onEnd: [] }
  return {
    calls,
    onStart(span) { calls.onStart.push(span) },
    onEnd(span) { calls.onEnd.push(span) }
  }
}

function makeSpan(overrides = {}) {
  return new NrSpan({
    name: 'test-span',
    kind: 0,
    spanContext: makeSpanContext(),
    instrumentationScope: { name: 'test', version: '1.0' },
    processor: makeProcessor(),
    ...overrides
  })
}

// ─── spanContext ─────────────────────────────────────────────────────────────

test('spanContext returns the stored span context', () => {
  const ctx = makeSpanContext()
  const span = makeSpan({ spanContext: ctx })
  assert.strictEqual(span.spanContext(), ctx)
})

// ─── setAttribute / setAttributes ────────────────────────────────────────────

test('setAttribute stores the value', () => {
  const span = makeSpan()
  span.setAttribute('key', 'value')
  assert.equal(span.attributes['key'], 'value')
})

test('setAttribute truncates string values longer than ATTR_VALUE_LENGTH_LIMIT', () => {
  const span = makeSpan()
  span.setAttribute('key', OVER_LIMIT)
  assert.equal(span.attributes['key'].length, ATTR_VALUE_LENGTH_LIMIT)
})

test('setAttribute does not truncate strings at exactly the limit', () => {
  const span = makeSpan()
  span.setAttribute('key', AT_LIMIT)
  assert.equal(span.attributes['key'].length, ATTR_VALUE_LENGTH_LIMIT)
})

test('setAttribute does not truncate non-string values', () => {
  const span = makeSpan()
  span.setAttribute('num', 12345)
  span.setAttribute('bool', true)
  assert.equal(span.attributes['num'], 12345)
  assert.equal(span.attributes['bool'], true)
})

test('setAttributes truncates all over-limit string values', () => {
  const span = makeSpan()
  span.setAttributes({ short: 'ok', long: OVER_LIMIT })
  assert.equal(span.attributes['short'], 'ok')
  assert.equal(span.attributes['long'].length, ATTR_VALUE_LENGTH_LIMIT)
})

test('constructor attributes are truncated', () => {
  const span = makeSpan({ attributes: { key: OVER_LIMIT } })
  assert.equal(span.attributes['key'].length, ATTR_VALUE_LENGTH_LIMIT)
})

// ─── addEvent ─────────────────────────────────────────────────────────────────

test('addEvent stores event with name', () => {
  const span = makeSpan()
  span.addEvent('my-event')
  assert.equal(span.events.length, 1)
  assert.equal(span.events[0].name, 'my-event')
})

test('addEvent stores event attributes', () => {
  const span = makeSpan()
  span.addEvent('ev', { foo: 'bar' })
  assert.equal(span.events[0].attributes.foo, 'bar')
})

test('addEvent truncates over-limit string event attributes', () => {
  const span = makeSpan()
  span.addEvent('ev', { key: OVER_LIMIT })
  assert.equal(span.events[0].attributes.key.length, ATTR_VALUE_LENGTH_LIMIT)
})

test('addEvent with a time argument does not treat it as attributes', () => {
  const span = makeSpan()
  const time = [1234, 0]
  span.addEvent('ev', time)
  assert.deepEqual(span.events[0].attributes, {})
})

// ─── addLink / addLinks ───────────────────────────────────────────────────────

test('addLink stores the link', () => {
  const span = makeSpan()
  const link = { context: makeSpanContext() }
  span.addLink(link)
  assert.equal(span.links.length, 1)
})

test('addLink truncates over-limit string link attributes', () => {
  const span = makeSpan()
  span.addLink({ context: makeSpanContext(), attributes: { key: OVER_LIMIT } })
  assert.equal(span.links[0].attributes.key.length, ATTR_VALUE_LENGTH_LIMIT)
})

test('addLink does not mutate the original link object', () => {
  const span = makeSpan()
  const link = { context: makeSpanContext(), attributes: { key: OVER_LIMIT } }
  span.addLink(link)
  assert.equal(link.attributes.key.length, OVER_LIMIT.length)
})

test('addLinks stores all links', () => {
  const span = makeSpan()
  span.addLinks([
    { context: makeSpanContext() },
    { context: makeSpanContext() }
  ])
  assert.equal(span.links.length, 2)
})

test('constructor links are truncated', () => {
  const link = { context: makeSpanContext(), attributes: { key: OVER_LIMIT } }
  const span = makeSpan({ links: [link] })
  assert.equal(span.links[0].attributes.key.length, ATTR_VALUE_LENGTH_LIMIT)
  assert.equal(link.attributes.key.length, OVER_LIMIT.length)
})

// ─── setStatus / updateName ───────────────────────────────────────────────────

test('setStatus updates status code and message', () => {
  const span = makeSpan()
  span.setStatus({ code: 2, message: 'oops' })
  assert.deepEqual(span.status, { code: 2, message: 'oops' })
})

test('updateName updates the span name', () => {
  const span = makeSpan()
  span.updateName('new-name')
  assert.equal(span.name, 'new-name')
})

// ─── isRecording / end ───────────────────────────────────────────────────────

test('isRecording returns true before end', () => {
  const span = makeSpan()
  assert.equal(span.isRecording(), true)
})

test('isRecording returns false after end', () => {
  const span = makeSpan()
  span.end()
  assert.equal(span.isRecording(), false)
})

test('end calls processor.onEnd', () => {
  const processor = makeProcessor()
  const span = makeSpan({ processor })
  span.end()
  assert.equal(processor.calls.onEnd.length, 1)
  assert.strictEqual(processor.calls.onEnd[0], span)
})

test('end is idempotent — processor.onEnd called exactly once', () => {
  const processor = makeProcessor()
  const span = makeSpan({ processor })
  span.end()
  span.end()
  assert.equal(processor.calls.onEnd.length, 1)
})

test('end computes a non-negative duration', () => {
  const span = makeSpan()
  span.end()
  const [seconds, nanos] = span.duration
  assert.ok(seconds >= 0)
  assert.ok(nanos >= 0)
})

// ─── recordException ──────────────────────────────────────────────────────────

test('recordException with a string adds an exception event', () => {
  const span = makeSpan()
  span.recordException('something broke')
  assert.equal(span.events.length, 1)
  assert.equal(span.events[0].name, 'exception')
  assert.equal(span.events[0].attributes['exception.message'], 'something broke')
})

test('recordException with an Error adds type, message, and stacktrace', () => {
  const span = makeSpan()
  const err = new Error('bad')
  span.recordException(err)
  const attrs = span.events[0].attributes
  assert.equal(attrs['exception.type'], 'Error')
  assert.equal(attrs['exception.message'], 'bad')
  assert.ok(attrs['exception.stacktrace'].includes('Error: bad'))
})

test('recordException with no useful info does not add an event', () => {
  const span = makeSpan()
  span.recordException({})
  assert.equal(span.events.length, 0)
})
