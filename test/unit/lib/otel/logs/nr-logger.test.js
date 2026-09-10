/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const NrLogger = require('#agentlib/otel/logs/nr-logger.js')

test('emit calls the handler with the log record', () => {
  const records = []
  const logger = new NrLogger((record) => records.push(record))
  const record = { body: 'hello', severityNumber: 9 }
  logger.emit(record)
  assert.equal(records.length, 1)
  assert.strictEqual(records[0], record)
})

test('emit calls the handler on each invocation', () => {
  let callCount = 0
  const logger = new NrLogger(() => { callCount += 1 })
  logger.emit({ body: 'first' })
  logger.emit({ body: 'second' })
  assert.equal(callCount, 2)
})
