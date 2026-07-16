/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const sinon = require('sinon')
const helper = require('#testlib/agent_helper.js')
const createMockProfilingAggregator = require('../mocks/profiling-aggregator')
const createLoggerMock = require('../mocks/logger')
const CommandParser = require('../../../lib/agent-commands/command-parser')
const CollectorResponse = require('../../../lib/collector/response')

function mockCollector() {
  const collector = {
    getAgentCommandsCalls: 0,
    sendCommandResultsCalls: [],
    // queued responses: each an object { error, response }
    getResponses: [],
    sendResponses: [],
    getAgentCommands(cb) {
      this.getAgentCommandsCalls++
      const next = this.getResponses.shift() || { response: CollectorResponse.success([]) }
      setImmediate(cb, next.error, next.response)
    },
    sendCommandResults(results, cb) {
      this.sendCommandResultsCalls.push(results)
      const next = this.sendResponses.shift() || { response: CollectorResponse.success(null) }
      setImmediate(cb, next.error, next.response)
    }
  }
  return collector
}

test.beforeEach((ctx) => {
  const sandbox = sinon.createSandbox()
  const collector = mockCollector()
  const agent = helper.loadMockedAgent()
  agent.collector = collector
  const { profilingData } = agent
  createMockProfilingAggregator({ sandbox, profilingData })
  const logger = createLoggerMock(sandbox)
  ctx.nr = { logger, agent, sandbox }
})

test.afterEach((ctx) => {
  helper.unloadAgent(ctx.nr.agent)
  ctx.nr.sandbox.restore()
})

function makeParser({ agent, logger }) {
  return new CommandParser({ agent }, { logger })
}

test('enabled is true outside serverless mode and false within it', (t) => {
  const { agent, logger } = t.nr
  assert.equal(makeParser({ agent, logger }).enabled, true)
  agent.config.serverless_mode.enabled = true
  assert.equal(
    makeParser({ agent, logger }).enabled,
    false
  )
})

test('does nothing when disabled', async (t) => {
  const { agent, logger } = t.nr
  agent.config.serverless_mode.enabled = true
  const parser = makeParser({ agent, logger })
  await parser.runCommands()
  assert.equal(agent.collector.getAgentCommandsCalls, 0)
})

test('executes a command and posts a result keyed by id', async (t) => {
  const { agent, logger } = t.nr
  agent.collector.getResponses.push({
    response: CollectorResponse.success([[841, { name: 'start_profiler', arguments: {} }]])
  })
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  assert.equal(agent.collector.sendCommandResultsCalls.length, 1)
  assert.deepEqual(agent.collector.sendCommandResultsCalls[0], { 841: {} })
})

test('reports a JSON exception result for an unknown command', async (t) => {
  const { agent, logger } = t.nr
  agent.collector.getResponses.push({
    response: CollectorResponse.success([[5, { name: 'nope', arguments: {} }]])
  })
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  assert.deepEqual(agent.collector.sendCommandResultsCalls[0], {
    5: { error: 'Unknown command "nope"' }
  })
})

test('skips malformed commands without reporting a result', async (t) => {
  const { agent, logger } = t.nr
  agent.collector.getResponses.push({
    response: CollectorResponse.success([[1], null, [2, null], [3, { arguments: {} }]])
  })
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  // Nothing valid to report, so no send happens.
  assert.equal(agent.collector.sendCommandResultsCalls.length, 0)
})

test('does not post when there are no commands', async (t) => {
  const { agent, logger } = t.nr
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  assert.equal(agent.collector.getAgentCommandsCalls, 1)
  assert.equal(agent.collector.sendCommandResultsCalls.length, 0)
})

test('swallows fetch errors and retries next harvest', async (t) => {
  const { agent, logger } = t.nr
  agent.collector.getResponses.push({ error: new Error('network down') })
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  assert.equal(agent.collector.sendCommandResultsCalls.length, 0)
  assert.equal(parser.backlog.length, 0)
})

test('backlogs results when the send retains data', async (t) => {
  const { agent, logger } = t.nr
  agent.collector.getResponses.push({
    response: CollectorResponse.success([[7, { name: 'start_profiler', arguments: {} }]])
  })
  agent.collector.sendResponses.push({ response: CollectorResponse.error(null) }) // retainData true
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  assert.equal(parser.backlog.length, 1)
  assert.deepEqual(parser.backlog[0], { 7: {} })
})

test('backlogs results when the send throws a transport error', async (t) => {
  const { agent, logger } = t.nr
  agent.collector.getResponses.push({
    response: CollectorResponse.success([[7, { name: 'start_profiler', arguments: {} }]])
  })
  agent.collector.sendResponses.push({ error: new Error('boom') })
  const parser = makeParser({ agent, logger })

  await parser.runCommands()

  assert.equal(parser.backlog.length, 1)
})

test('retry: successful backlog send drops the entry', async (t) => {
  const { agent, logger } = t.nr
  const parser = makeParser({ agent, logger })
  parser.backlog.push({ 1: {} })
  // backlog retry succeeds; fetch returns nothing
  agent.collector.sendResponses.push({ response: CollectorResponse.success(null) })

  await parser.runCommands()

  assert.equal(parser.backlog.length, 0)
})

test('retry: HTTP error that retains data keeps the entry', async (t) => {
  const { agent, logger } = t.nr
  const parser = makeParser({ agent, logger })
  parser.backlog.push({ 1: {} })
  agent.collector.sendResponses.push({ response: CollectorResponse.error(null) }) // retainData true

  await parser.runCommands()

  assert.equal(parser.backlog.length, 1)
})

test('retry: HTTP error that discards data drops the entry', async (t) => {
  const { agent, logger } = t.nr
  const parser = makeParser({ agent, logger })
  parser.backlog.push({ 1: {} })
  agent.collector.sendResponses.push({ response: CollectorResponse.discard(null) }) // retainData false

  await parser.runCommands()

  assert.equal(parser.backlog.length, 0)
})

test('retry: other exception discards the entry', async (t) => {
  const { agent, logger } = t.nr
  const parser = makeParser({ agent, logger })
  parser.backlog.push({ 1: {} })
  agent.collector.sendResponses.push({ error: new Error('socket hang up') })

  await parser.runCommands()

  assert.equal(parser.backlog.length, 0)
})
