/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { test } = require('tap')

const runTests = require('./promises')

test('Promises (await_support: false)', (t) => {
  runTests(t, {
    await_support: false,
    legacy_context_manager: true
  })
  t.end()
})

test('Promises (await_support: true)', (t) => {
  runTests(t, {
    await_support: true,
    legacy_context_manager: true
  })
  t.end()
})
