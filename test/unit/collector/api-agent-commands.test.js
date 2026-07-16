/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const promiseResolvers = require('../../lib/promise-resolvers')
const Collector = require('../../lib/test-collector')
const helper = require('../../lib/agent_helper')
const CollectorApi = require('../../../lib/collector/api')

const RUN_ID = 1337
const baseAgentConfig = {
  app_name: ['TEST'],
  ssl: true,
  license_key: 'license key here',
  utilization: {
    detect_aws: false,
    detect_pcf: false,
    detect_azure: false,
    detect_gcp: false,
    detect_docker: false
  },
  browser_monitoring: {},
  transaction_tracer: {}
}

test('registers the agent_command_results endpoint', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { collectorApi } = t.nr
  assert.ok(collectorApi._methods.agent_command_results)
  assert.equal(collectorApi._methods.agent_command_results.name, 'agent_command_results')
  assert.equal(collectorApi._methods.get_agent_commands, undefined)
})

test('_handleResponseCode calls processInbandCommands when agent_actions is in the payload', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { agent, collector, collectorApi } = t.nr
  const { promise, resolve } = promiseResolvers()
  const agentActions = [[1, { name: 'start_profiler', arguments: { profile_id: 42 } }]]

  // Capture the call to processInbandCommands
  let capturedCommands = null
  agent.commandParser = {
    processInbandCommands(rawCommands) {
      capturedCommands = rawCommands
      return Promise.resolve()
    }
  }

  collector.addHandler(
    helper.generateCollectorPath('agent_command_results', RUN_ID),
    (req, res) => {
      // agent_actions is a sibling to return_value in the response body, not nested inside it.
      res.json({ payload: { return_value: null, agent_actions: agentActions } })
    }
  )
  agent.config.run_id = RUN_ID

  collectorApi.sendCommandResults({ 1: {} }, (error) => {
    assert.equal(error, undefined)
    // Give the fire-and-forget promise a tick to settle
    setImmediate(() => {
      assert.deepEqual(capturedCommands, agentActions)
      resolve()
    })
  })

  await promise
})

test('_handleResponseCode does not call processInbandCommands when agent_actions is absent', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { agent, collector, collectorApi } = t.nr
  const { promise, resolve } = promiseResolvers()

  let called = false
  agent.commandParser = {
    processInbandCommands() {
      called = true
      return Promise.resolve()
    }
  }

  collector.addHandler(
    helper.generateCollectorPath('agent_command_results', RUN_ID),
    (req, res) => {
      res.json({ payload: { return_value: null } })
    }
  )
  agent.config.run_id = RUN_ID

  collectorApi.sendCommandResults({ 1: {} }, (error) => {
    assert.equal(error, undefined)
    setImmediate(() => {
      assert.equal(called, false)
      resolve()
    })
  })

  await promise
})

test('sendCommandResults posts the run id and results and reports success', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { agent, collector, collectorApi } = t.nr
  const { promise, resolve } = promiseResolvers()
  const results = { 841: {} }

  collector.addHandler(
    helper.generateCollectorPath('agent_command_results', RUN_ID),
    (req, res) => {
      res.json({ payload: { return_value: null } })
    }
  )
  agent.config.run_id = RUN_ID

  collectorApi.sendCommandResults(results, (error, response) => {
    assert.equal(error, undefined)
    assert.equal(response.retainData, false)
    assert.equal(collector.isDone('agent_command_results'), true)
    resolve()
  })

  await promise
})

test('sendCommandResults retains data on a 500', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { agent, collector, collectorApi } = t.nr
  const { promise, resolve } = promiseResolvers()

  collector.addHandler(
    helper.generateCollectorPath('agent_command_results', RUN_ID),
    (req, res) => {
      res.writeHead(500)
      res.end()
    }
  )
  agent.config.run_id = RUN_ID

  collectorApi.sendCommandResults({ 1: {} }, (error, response) => {
    assert.equal(error, undefined)
    assert.equal(response.retainData, true)
    resolve()
  })

  await promise
})

async function beforeEach(ctx) {
  ctx.nr = {}

  const collector = new Collector({ runId: RUN_ID })
  ctx.nr.collector = collector
  await collector.listen()

  const config = Object.assign({}, baseAgentConfig, collector.agentConfig, {
    config: { run_id: RUN_ID }
  })
  ctx.nr.agent = helper.loadMockedAgent(config)
  ctx.nr.agent.reconfigure = function () {}
  ctx.nr.agent.setState = function () {}

  ctx.nr.collectorApi = new CollectorApi(ctx.nr.agent)
}

function afterEach(ctx) {
  helper.unloadAgent(ctx.nr.agent)
  ctx.nr.collector.close()
}
