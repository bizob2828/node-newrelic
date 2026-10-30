/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const assert = require('node:assert')
const test = require('node:test')
const EventEmitter = require('node:events')
const sinon = require('sinon')
const HttpSubscriber = require('#agentlib/subscribers/core/http.js')
const HttpsSubscriber = require('#agentlib/subscribers/core/https.js')
const symbols = require('#agentlib/symbols.js')
const helper = require('#testlib/agent_helper.js')
const loggerMock = require('../../../mocks/logger')

function makeRequestResponse(overrides = {}) {
  const request = new EventEmitter()
  request.url = overrides.url ?? '/foo'
  request.method = overrides.method ?? 'GET'
  request.headers = overrides.headers ?? {}

  const response = new EventEmitter()
  response.statusCode = 200
  response.statusMessage = 'OK'
  response.getHeaders = () => { return {} }

  return { request, response }
}

test.beforeEach((ctx) => {
  const agent = helper.loadMockedAgent()
  const logger = loggerMock()
  const subscriber = new HttpSubscriber({ agent, logger })
  ctx.nr = { agent, subscriber, logger }
})

test.afterEach((ctx) => {
  const { agent, subscriber } = ctx.nr
  subscriber.disable()
  subscriber.unsubscribe()
  helper.unloadAgent(agent)
})

test('enabled should respect the instrumentation.http config toggle', (t) => {
  const { subscriber } = t.nr
  subscriber.config.instrumentation.http.enabled = false
  assert.equal(subscriber.enabled, false)

  subscriber.config.instrumentation.http.enabled = true
  assert.equal(subscriber.enabled, true)
})

test('handler should do nothing when the agent cannot collect data', (t) => {
  const { agent, subscriber } = t.nr
  sinon.stub(agent, 'canCollectData').returns(false)

  const ctx = agent.tracer.getContext()
  const { request, response } = makeRequestResponse()
  const result = subscriber.handler({ request, response, port: 1234 }, ctx)

  assert.equal(result, ctx)
  assert.equal(agent.getTransaction(), null)
})

test('handler should not nest a transaction when one is already active', (t) => {
  const { agent, subscriber } = t.nr
  const supportabilitySpy = sinon.spy(agent, 'recordSupportability')

  helper.runInTransaction(agent, (tx) => {
    const ctx = agent.tracer.getContext()
    const { request, response } = makeRequestResponse()
    const result = subscriber.handler({ request, response, port: 1234 }, ctx)

    assert.equal(result, ctx)
    assert.equal(agent.getTransaction().id, tx.id)
    assert.equal(supportabilitySpy.calledWith('Nodejs/Transactions/Nested'), true)
    tx.end()
  })
})

test('handler should only finalize once when both finish and close fire', (t) => {
  const { agent, subscriber } = t.nr
  const ctx = agent.tracer.getContext()
  const { request, response } = makeRequestResponse()

  const newCtx = subscriber.handler({ request, response, port: 1234 }, ctx)
  const finalizeSpy = sinon.spy(newCtx.transaction, 'finalizeWeb')

  response.emit('finish')
  response.emit('close')

  assert.equal(finalizeSpy.callCount, 1)
  newCtx.transaction.end()
})

test('instrument should decline to wrap when in an azure functions environment', (t) => {
  const { subscriber, logger } = t.nr
  process.env.FUNCTIONS_WORKER_RUNTIME = 'node'
  t.after(() => {
    delete process.env.FUNCTIONS_WORKER_RUNTIME
  })

  const http = { createServer: () => {}, Server: { prototype: {} } }
  subscriber.instrument(http)

  assert.equal(logger.debug.callCount, 1)
  assert.equal(http.createServer[symbols.unwrap], undefined)
})

test('instrument should not throw when ServerResponse is missing (https)', (t) => {
  const { agent, logger } = t.nr
  const subscriber = new HttpsSubscriber({ agent, logger })
  // `https` has no `ServerResponse`/`IncomingMessage` of its own.
  const https = { createServer: () => {}, Server: { prototype: new EventEmitter() } }

  assert.doesNotThrow(() => subscriber.instrument(https))
})
