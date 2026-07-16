/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const helper = require('#testlib/agent_helper.js')
const createMockProfilingAggregator = require('../mocks/profiling-aggregator')

const { commands } = require('../../../lib/agent-commands/commands')

test.beforeEach((ctx) => {
  const agent = helper.loadMockedAgent({ profiling: { enabled: false } })
  const { profilingData } = agent
  createMockProfilingAggregator({ profilingData })
  ctx.nr = { agent, profilingData }
})

test.afterEach((ctx) => {
  helper.unloadAgent(ctx.nr.agent)
})

test('start_profiler enables profiling, initializes the source mapper, and starts the profiler', async (t) => {
  const { agent, profilingData } = t.nr
  const result = await commands.start_profiler(agent)
  assert.equal(agent.config.profiling.enabled, true)
  assert.equal(profilingData.initSourceMapper.callCount, 1)
  assert.equal(profilingData.reconfigure.callCount, 1)
  assert.equal(profilingData.start.callCount, 1)
  assert.deepEqual(result, {})
})

test('stop_profiler collects data and stops the profiler', async (t) => {
  const { agent, profilingData } = t.nr
  const result = await commands.stop_profiler(agent)
  assert.equal(profilingData.collectData.callCount, 1)
  assert.equal(profilingData.stop.callCount, 1)
  assert.equal(profilingData.end.callCount, 1)
  assert.deepEqual(result, {})
})
