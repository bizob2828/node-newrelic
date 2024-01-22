/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { test } = require('tap')

const runContextManagerTests = require('./context-manager-tests')
const AsyncLocalContextManager = require('../../../lib/context-manager/async-local-context-manager')

test('Async Local Context Manager', (t) => {
  runContextManagerTests(t, createContextManager)
  t.end()
})

function createContextManager() {
  return new AsyncLocalContextManager({})
}
