/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { nowUnixNano } = require('#agentlib/otel/metrics/sdk/time.js')

test('returns an integer', (t) => {
  const result = nowUnixNano()
  assert.equal(typeof result, 'number')
  assert.equal(Number.isInteger(result), true)
})

test('is anchored to the Unix epoch, not process start', (t) => {
  // If this were anchored to process start (e.g. a naive `process.hrtime()`
  // use) rather than wall-clock time, it would report a value near zero.
  const nowNano = nowUnixNano()
  const expectedNano = Date.now() * 1e6
  const toleranceNano = 5_000 * 1e6 // 5 seconds, generous for test/CI jitter
  assert.ok(
    Math.abs(nowNano - expectedNano) < toleranceNano,
    `expected ${nowNano} to be within ${toleranceNano}ns of ${expectedNano}`
  )
})

test('is monotonically non-decreasing across successive calls', (t) => {
  const first = nowUnixNano()
  const second = nowUnixNano()
  assert.ok(second >= first, `expected ${second} >= ${first}`)
})
