/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { stableStringify } = require('#agentlib/otel/metrics/stable-stringify.js')

test('stringifies primitives like JSON.stringify', (t) => {
  assert.equal(stableStringify('foo'), '"foo"')
  assert.equal(stableStringify(42), '42')
  assert.equal(stableStringify(true), 'true')
  assert.equal(stableStringify(false), 'false')
  assert.equal(stableStringify(null), 'null')
  assert.equal(stableStringify(undefined), undefined)
})

test('produces the same string for the same keys regardless of insertion order', (t) => {
  const a = { foo: '1', bar: '2' }
  const b = { bar: '2', foo: '1' }
  assert.equal(stableStringify(a), stableStringify(b))
})

test('produces different strings for different values', (t) => {
  assert.notEqual(stableStringify({ a: '1' }), stableStringify({ a: '2' }))
  assert.notEqual(stableStringify({ a: '1' }), stableStringify({ b: '1' }))
})

test('handles nested objects, sorting keys at every level', (t) => {
  const a = { outer: { foo: '1', bar: '2' }, z: '1' }
  const b = { z: '1', outer: { bar: '2', foo: '1' } }
  assert.equal(stableStringify(a), stableStringify(b))
})

test('preserves array order rather than sorting it', (t) => {
  assert.notEqual(stableStringify(['a', 'b']), stableStringify(['b', 'a']))
  assert.equal(stableStringify(['a', 'b']), stableStringify(['a', 'b']))
})

test('handles arrays of objects', (t) => {
  const a = [{ foo: '1', bar: '2' }, { x: '1' }]
  const b = [{ bar: '2', foo: '1' }, { x: '1' }]
  assert.equal(stableStringify(a), stableStringify(b))
})

test('handles empty objects and arrays', (t) => {
  assert.equal(stableStringify({}), '{}')
  assert.equal(stableStringify([]), '[]')
})

test('handles objects whose values are arrays and vice versa', (t) => {
  const a = { list: ['a', 'b'], name: 'x' }
  const b = { name: 'x', list: ['a', 'b'] }
  assert.equal(stableStringify(a), stableStringify(b))

  const c = [{ a: '1', b: '2' }]
  const d = [{ b: '2', a: '1' }]
  assert.equal(stableStringify(c), stableStringify(d))
})
