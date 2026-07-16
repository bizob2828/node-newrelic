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

test('registers the agent command endpoints', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { collectorApi } = t.nr
  assert.ok(collectorApi._methods.get_agent_commands)
  assert.ok(collectorApi._methods.agent_command_results)
  assert.equal(collectorApi._methods.get_agent_commands.name, 'get_agent_commands')
  assert.equal(collectorApi._methods.agent_command_results.name, 'agent_command_results')
})

test('getAgentCommands returns the command list from the payload', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { agent, collector, collectorApi } = t.nr
  const { promise, resolve } = promiseResolvers()
  const returnValue = [[841, { name: 'start_profiler', arguments: { profile_id: 1 } }]]

  collector.addHandler(helper.generateCollectorPath('get_agent_commands', RUN_ID), (req, res) => {
    res.json({ payload: { return_value: returnValue } })
  })
  agent.config.run_id = RUN_ID

  collectorApi.getAgentCommands((error, response) => {
    assert.equal(error, undefined)
    assert.deepEqual(response.payload, returnValue)
    assert.equal(collector.isDone('get_agent_commands'), true)
    resolve()
  })

  await promise
})

test('getAgentCommands bails out when not connected', async (t) => {
  await beforeEach(t)
  t.after(() => afterEach(t))

  const { collectorApi } = t.nr
  const { promise, resolve } = promiseResolvers()

  collectorApi.getAgentCommands((error) => {
    assert.equal(error.message, 'Not connected to collector.')
    resolve()
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
