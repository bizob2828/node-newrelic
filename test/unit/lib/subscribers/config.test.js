/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { removeMatchedModules } = require('#testlib/cache-buster.js')

test.beforeEach((ctx) => {
  const { formatConfig } = require('#agentlib/subscribers/config.js')
  ctx.nr = {
    formatConfig
  }
})

test.afterEach(() => {
  removeMatchedModules(/.*\/lib\/subscribers\/config\.js/)
})

test('should return packages and instrumentations', (t) => {
  const { formatConfig } = t.nr
  const subscribers = [
    {
      moduleName: 'express',
      instrumentations: [
        {
          module: { name: 'express' },
        },
        {
          module: { name: 'express-middleware' },
        }
      ]
    },
    {
      moduleName: 'fastify',
      instrumentations: [
        {
          module: { name: 'fastify' },
        }
      ]
    },
    {
      instrumentations: [
        {
          module: { name: 'standalone-module' }
        }
      ]
    }
  ]

  const result = formatConfig(subscribers)

  assert.equal(result.packages.length, 4, 'packages should have five unique entries')
  assert.deepStrictEqual(result.packages, ['express', 'express-middleware', 'fastify', 'standalone-module'])
  assert.equal(result.instrumentations.length, 4, 'should have four instrumentations')
})

test('should return cached data on subsequent calls', (t) => {
  const { formatConfig } = t.nr
  const subscribers1 = [
    {
      moduleName: 'first-call',
      instrumentations: [{ type: 'first' }]
    }
  ]

  const result1 = formatConfig(subscribers1)

  assert.equal(result1.packages.length, 1)
  assert.deepStrictEqual(result1.packages, ['first-call'])
  assert.equal(result1.instrumentations.length, 1)

  // Second call with different data should return cached result
  const subscribers2 = [
    {
      moduleName: 'second-call',
      instrumentations: [{ type: 'second' }]
    }
  ]

  const result2 = formatConfig(subscribers2)

  // Should return the same cached data
  assert.strictEqual(result2.instrumentations, result1.instrumentations, 'should return same instrumentations array')
  assert.strictEqual(result2.packages, result1.packages, 'should return same packages Set')
})

test('should handle empty array input', (t) => {
  const { formatConfig } = t.nr
  const result = formatConfig([])

  assert.ok(result, 'should return a result')
  assert.ok(Array.isArray(result.instrumentations), 'instrumentations should be an array')
  assert.ok(Array.isArray(result.packages), 'packages should be an array')
  assert.equal(result.instrumentations.length, 0, 'instrumentations should be empty')
  assert.equal(result.packages.length, 0, 'packages should be empty')
})

test('should handle no arguments load all configured subscribers', (t) => {
  const { formatConfig } = t.nr
  const result = formatConfig()

  assert.ok(result, 'should return a result')
  assert.ok(Array.isArray(result.instrumentations), 'instrumentations should be an array')
  assert.ok(Array.isArray(result.packages), 'packages should be an array')
  assert.ok(result.instrumentations.length > 0)
  assert.ok(result.packages.length > 0)
})

test('should deduplicate package names', (t) => {
  const { formatConfig } = t.nr
  const subscribers = [
    {
      moduleName: 'duplicate-package',
      instrumentations: []
    },
    {
      moduleName: 'duplicate-package',
      instrumentations: []
    }
  ]

  const result = formatConfig(subscribers)

  assert.equal(result.packages.length, 1, 'packages should deduplicate and have one entry')
  assert.deepStrictEqual(result.packages, ['duplicate-package'], 'packages should contain duplicate-package')
  assert.equal(result.instrumentations.length, 0, 'instrumentations should be empty')
})

test('should deduplicate package names from moduleName', (t) => {
  const { formatConfig } = t.nr
  const subscribers = [
    {
      instrumentations: [
        {
          module: {
            name: 'duplicate-instrumentation'
          }
        },
        {
          module: {
            name: 'duplicate-instrumentation'
          }
        }
      ]
    }
  ]

  const result = formatConfig(subscribers)

  assert.equal(result.packages.length, 1, 'packages should deduplicate and have one entry')
  assert.deepStrictEqual(result.packages, ['duplicate-instrumentation'], 'packages should contain duplicate-instrumentation')
  assert.equal(result.instrumentations.length, 2, 'should still have two instrumentations in array')
})
