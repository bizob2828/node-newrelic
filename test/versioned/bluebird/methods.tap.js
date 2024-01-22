/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const tap = require('tap')
const testMethods = require('./methods')

tap.test('bluebird methods', function (t) {
  testMethods(t, 'bluebird', loadBluebird)
  t.end()
})

function loadBluebird() {
  return require('bluebird') // Load relative to this file.
}
