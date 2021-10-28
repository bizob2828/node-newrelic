/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const LegacyMgr = require('./legacy')
const AsyncLocalMgr = require('./async-local-storage')

module.exports = function contextManager(config) {
  return config.feature_flag.use_legacy_context ? new LegacyMgr() : new AsyncLocalMgr()
}
