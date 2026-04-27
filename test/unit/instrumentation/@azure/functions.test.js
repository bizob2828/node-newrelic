/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const helper = require('#testlib/agent_helper.js')
const { removeMatchedModules } = require('#testlib/cache-buster.js')
const Transaction = require('#agentlib/transaction/index.js')

const { DESTINATIONS: DESTS } = require('#agentlib/transaction/index.js')

test.beforeEach((ctx) => {
  ctx.nr = {}

  ctx.nr.agent = helper.loadMockedAgent()

  ctx.nr.logger = {
    warn() {},
    debug() {},
    trace() {},
    child() {
      return ctx.nr.logger
    }
  }

  process.env.WEBSITE_OWNER_NAME = 'b999997b-cb91-49e0-b922-c9188372bdba+testing-rg-EastUS2webspace-Linux'
  process.env.WEBSITE_RESOURCE_GROUP = 'test-group'
  process.env.WEBSITE_SITE_NAME = 'test-site'
})

test.afterEach((ctx) => {
  helper.unloadAgent(ctx.nr.agent)
  removeMatchedModules(/lib\/subscribers\/azure-functions\//)

  delete process.env.WEBSITE_OWNER_NAME
  delete process.env.WEBSITE_RESOURCE_GROUP
  delete process.env.WEBSITE_SITE_NAME
})

function bootstrapSubscriber({ t }) {
  removeMatchedModules(/lib\/subscribers\/azure-functions\//)
  const AzureFunctionsSubscriber =
    require('#agentlib/subscribers/azure-functions/index.js')
  t.nr.subscriber = new AzureFunctionsSubscriber({
    agent: t.nr.agent,
    logger: t.nr.logger
  })
}

test('addFaasAttributes adds expected attributes', (t) => {
  bootstrapSubscriber({ t })
  const { agent, subscriber } = t.nr
  const AzureHandlerBase = require('#agentlib/subscribers/azure-functions/azure-handler-base.js')
  const handler = new AzureHandlerBase(subscriber)
  const transaction = new Transaction(agent)
  const functionContext = {
    invocationId: 'id-123',
    functionName: 'test-func',
    options: {
      trigger: {
        type: 'httpTrigger'
      }
    }
  }
  handler.addFaasAttributes(transaction, functionContext)

  const attributes = transaction.trace.attributes.get(DESTS.TRANS_COMMON)
  assert.equal(attributes['faas.invocation_id'], 'id-123')
  assert.equal(attributes['faas.name'], 'test-func')
  assert.equal(attributes['faas.trigger'], 'http')
  assert.equal(
    attributes['cloud.resource_id'],
    '/subscriptions/b999997b-cb91-49e0-b922-c9188372bdba/resourceGroups/test-group/providers/Microsoft.Web/sites/test-site/functions/test-func'
  )
})

test('buildCloudResourceId returns correct string', (t) => {
  bootstrapSubscriber({ t })
  const { subscriber } = t.nr
  const AzureHandlerBase = require('#agentlib/subscribers/azure-functions/azure-handler-base.js')
  const handler = new AzureHandlerBase(subscriber)
  const id = handler.buildCloudResourceId({ functionName: 'test-func' })
  assert.equal(id, [
    '/subscriptions/',
    'b999997b-cb91-49e0-b922-c9188372bdba',
    '/resourceGroups/',
    'test-group',
    '/providers/Microsoft.Web/sites/',
    'test-site',
    '/functions/',
    'test-func'
  ].join(''))
})

test('buildCloudResourceId returns correct string (missing WEBSITE_RESOURCE_GROUP)', (t) => {
  delete process.env.WEBSITE_RESOURCE_GROUP
  bootstrapSubscriber({ t })
  const { subscriber } = t.nr
  const AzureHandlerBase = require('#agentlib/subscribers/azure-functions/azure-handler-base.js')
  const handler = new AzureHandlerBase(subscriber)
  const id = handler.buildCloudResourceId({ functionName: 'test-func' })
  assert.equal(id, [
    '/subscriptions/',
    'b999997b-cb91-49e0-b922-c9188372bdba',
    '/resourceGroups/',
    'testing-rg-EastUS2webspace',
    '/providers/Microsoft.Web/sites/',
    'test-site',
    '/functions/',
    'test-func'
  ].join(''))
})

test('mapTriggerType maps recognized keys', (t) => {
  bootstrapSubscriber({ t })
  const { subscriber } = t.nr
  const AzureHandlerBase = require('#agentlib/subscribers/azure-functions/azure-handler-base.js')
  const handler = new AzureHandlerBase(subscriber)
  const testData = [
    ['blobTrigger', 'datasource'],
    ['cosmosDBTrigger', 'datasource'],
    ['daprBindingTrigger', 'datasource'],
    ['daprServiceInvocationTrigger', 'other'],
    ['daprTopicTrigger', 'pubsub'],
    ['eventGridTrigger', 'pubsub'],
    ['eventHubTrigger', 'pubsub'],
    ['httpTrigger', 'http'],
    ['kafkaTrigger', 'pubsub'],
    ['mysqlTrigger', 'datasource'],
    ['not-recognized', 'other'],
    ['queueTrigger', 'datasource'],
    ['rabbitMQTrigger', 'pubsub'],
    ['redisListTrigger', 'pubsub'],
    ['redisPubSubTrigger', 'pubsub'],
    ['redisStreamTrigger', 'pubsub'],
    ['serviceBusTrigger', 'pubsub'],
    ['signalRTrigger', 'pubsub'],
    ['sqlTrigger', 'datasource'],
    ['timerTrigger', 'timer'],
    ['webPubSubTrigger', 'pubsub'],
  ]

  for (const [input, expected] of testData) {
    const ctx = { options: { trigger: { type: input } } }
    const found = handler.mapTriggerType(ctx)
    assert.equal(found, expected)
  }
})
