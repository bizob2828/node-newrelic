/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  nowHrTime,
  toHrTime,
  hrTimeDiff,
  hrTimeToMilliseconds
} = require('#agentlib/otel/utils/hr-time.js')

test('nowHrTime returns a [seconds, nanoseconds] tuple', () => {
  const found = nowHrTime()
  assert.equal(Array.isArray(found), true)
  assert.equal(found.length, 2)
  assert.equal(typeof found[0], 'number')
  assert.equal(typeof found[1], 'number')
})

test('nowHrTime represents the current time', () => {
  const before = Date.now()
  const [seconds, nanos] = nowHrTime()
  const after = Date.now()

  assert.equal(nanos >= 0 && nanos < 1_000_000_000, true)

  const ms = seconds * 1_000 + nanos / 1e6
  assert.equal(ms >= before - 5, true)
  assert.equal(ms <= after + 5, true)
})

test('toHrTime returns the current time when input is null', () => {
  const before = Date.now()
  const [seconds, nanos] = toHrTime(null)
  const after = Date.now()

  const ms = seconds * 1_000 + nanos / 1e6
  assert.equal(ms >= before - 5, true)
  assert.equal(ms <= after + 5, true)
})

test('toHrTime returns the current time when input is undefined', () => {
  const before = Date.now()
  const [seconds, nanos] = toHrTime(undefined)
  const after = Date.now()

  const ms = seconds * 1_000 + nanos / 1e6
  assert.equal(ms >= before - 5, true)
  assert.equal(ms <= after + 5, true)
})

test('toHrTime returns an existing HrTime tuple unchanged', () => {
  const input = [42, 123456789]
  const found = toHrTime(input)

  assert.deepStrictEqual(found, [42, 123456789])
  assert.strictEqual(found, input)
})

test('toHrTime converts a Date instance', () => {
  const found = toHrTime(new Date(1752577200123))
  assert.deepStrictEqual(found, [1752577200, 123000000])
})

test('toHrTime converts a Date instance with no millisecond remainder', () => {
  const found = toHrTime(new Date(1752577200000))
  assert.deepStrictEqual(found, [1752577200, 0])
})

test('toHrTime converts epoch milliseconds', () => {
  const found = toHrTime(1752577200123)
  assert.deepStrictEqual(found, [1752577200, 123000000])
})

test('toHrTime converts epoch millisecond 0', () => {
  const found = toHrTime(0)
  assert.deepStrictEqual(found, [0, 0])
})

test('hrTimeDiff computes a simple positive difference', () => {
  const found = hrTimeDiff([10, 0], [12, 500000000])
  assert.deepStrictEqual(found, [2, 500000000])
})

test('hrTimeDiff returns zero for identical times', () => {
  const found = hrTimeDiff([5, 123], [5, 123])
  assert.deepStrictEqual(found, [0, 0])
})

test('hrTimeDiff borrows a second on nanosecond underflow', () => {
  const found = hrTimeDiff([10, 500000000], [12, 200000000])
  assert.deepStrictEqual(found, [1, 700000000])
})

test('hrTimeDiff handles an end time earlier than the start time', () => {
  const found = hrTimeDiff([10, 0], [8, 0])
  assert.deepStrictEqual(found, [-2, 0])
})

test('hrTimeToMilliseconds converts seconds and nanoseconds', () => {
  const found = hrTimeToMilliseconds([1, 500000000])
  assert.equal(found, 1500)
})

test('hrTimeToMilliseconds handles a zero duration', () => {
  const found = hrTimeToMilliseconds([0, 0])
  assert.equal(found, 0)
})

test('hrTimeToMilliseconds does not truncate fractional milliseconds', () => {
  const found = hrTimeToMilliseconds([1, 500001])
  assert.equal(Math.abs(found - 1000.500001) < 1e-9, true)
})

test('nowHrTime, toHrTime, hrTimeDiff, and hrTimeToMilliseconds compose to round-trip a duration', () => {
  const start = nowHrTime()
  const endMs = start[0] * 1_000 + start[1] / 1e6 + 250
  const end = toHrTime(endMs)

  const diff = hrTimeDiff(start, end)
  const durationMs = hrTimeToMilliseconds(diff)

  assert.equal(Math.abs(durationMs - 250) < 1, true)
})
