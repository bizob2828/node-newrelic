/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const sinon = require('sinon')

module.exports = function createMockProfilingAggregator({ sandbox = sinon, profilingData } = {}) {
  sandbox.spy(profilingData, 'initSourceMapper')
  sandbox.spy(profilingData, 'reconfigure')
  sandbox.spy(profilingData, 'start')
  sandbox.spy(profilingData, 'collectData')
  sandbox.spy(profilingData, 'stop')
  sandbox.spy(profilingData, 'end')
}
