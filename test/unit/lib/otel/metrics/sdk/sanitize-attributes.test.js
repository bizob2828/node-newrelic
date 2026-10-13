/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { sanitizeAttributes } = require('#agentlib/otel/metrics/sdk/sanitize-attributes.js')

test('keeps valid primitive values', (t) => {
  assert.deepEqual(
    sanitizeAttributes({ str: 'a', num: 1, bool: true }),
    { str: 'a', num: 1, bool: true }
  )
})

test('keeps null and undefined values', (t) => {
  assert.deepEqual(
    sanitizeAttributes({ a: null, b: undefined }),
    { a: null, b: undefined }
  )
})

test('drops an empty string key', (t) => {
  assert.deepEqual(sanitizeAttributes({ '': 'dropped', keep: 'yes' }), { keep: 'yes' })
})

test('drops a plain object value', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: { nested: 'object' } }), {})
})

test('drops a function value', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: () => {} }), {})
})

test('keeps a homogeneous array of strings/numbers/booleans', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: ['x', 'y'] }), { a: ['x', 'y'] })
  assert.deepEqual(sanitizeAttributes({ a: [1, 2, 3] }), { a: [1, 2, 3] })
  assert.deepEqual(sanitizeAttributes({ a: [true, false] }), { a: [true, false] })
})

test('drops an array mixing primitive types', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: ['x', 1] }), {})
})

test('keeps an array of a consistent type interspersed with null/undefined', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: ['x', null, undefined, 'y'] }), { a: ['x', null, undefined, 'y'] })
})

test('keeps an array that is entirely null/undefined', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: [null, undefined, null] }), { a: [null, undefined, null] })
})

test('keeps an empty array', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: [] }), { a: [] })
})

test('drops an array containing an object', (t) => {
  assert.deepEqual(sanitizeAttributes({ a: ['x', {}] }), {})
})

test('copies array values rather than retaining the original reference', (t) => {
  const original = ['x', 'y']
  const sanitized = sanitizeAttributes({ a: original })
  assert.notEqual(sanitized.a, original)
  original.push('z')
  assert.deepEqual(sanitized.a, ['x', 'y'])
})

test('does not mutate the input object', (t) => {
  const input = { a: '1', b: { nested: true } }
  const copy = { ...input }
  sanitizeAttributes(input)
  assert.deepEqual(input, copy)
})

test('returns an empty object for non-object input', (t) => {
  assert.deepEqual(sanitizeAttributes(null), {})
  assert.deepEqual(sanitizeAttributes(undefined), {})
  assert.deepEqual(sanitizeAttributes('a string'), {})
  assert.deepEqual(sanitizeAttributes(42), {})
})

test('returns an empty object when called with no arguments', (t) => {
  assert.deepEqual(sanitizeAttributes(), {})
})
