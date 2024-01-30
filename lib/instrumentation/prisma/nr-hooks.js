/*
 * Copyright 2022 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const instrumentation = require('./index')
debugger

module.exports = [
  {
    type: 'datastore',
    moduleName: '@prisma/client',
    onRequire: instrumentation
  },
  {
    type: 'datastore',
    moduleName: '@prisma/client/runtime/library',
    onRequire: instrumentation
  },
  {
    type: 'datastore',
    moduleName: '@prisma/client/default',
    onRequire: instrumentation
  }
]
