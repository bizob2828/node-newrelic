/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { test } = require('tap')

const runContextManagerTests = require('./context-manager-tests')
const LegacyContextManager = require('../../../lib/context-manager/legacy-context-manager')

test('Legacy Context Manager', (t) => {
  runContextManagerTests(t, createLegacyContextManager)
  t.end()
})

function createLegacyContextManager() {
  return new LegacyContextManager({})
}
