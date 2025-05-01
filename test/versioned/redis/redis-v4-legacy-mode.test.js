/*
 * Copyright 2024 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const helper = require('../../lib/agent_helper')
const { removeMatchedModules } = require('../../lib/cache-buster')
const params = require('../../lib/params')
const urltils = require('../../../lib/util/urltils')
const { checkMetrics } = require('./utils')
const semver = require('semver')
const { promisify } = require('node:util')

function isRedis5Plus(version) {
  return semver.satisfies(version, '>=5.0.0')
}

/**
 * Redis v5 legacy changed.  Not only do you have to run the function in promisify
 * but some commands do not exist on the legacy client.
 *
 * @param {object} params to function
 * @param params.isV5
 * @param {boolean} isV5 is package v5+
 * @param {object} params.client redis client
 * @param {object} params.legacyClient legacy client
 * @param {string} params.cmd command to execute
 * @param {array} params.args args passed to command
 * @returns {Promise} promise to await result
 *
 */
function legacyCall({ isV5, client, legacyClient, cmd, args = [] }) {
  if (isV5 && client) {
    return client[cmd](...args)
  } else if (isV5) {
    return promisify(legacyClient[cmd]).call(legacyClient, ...args)
  } else {
    return legacyClient[cmd](...args)
  }
}

// Indicates unique database in Redis. 0-15 supported.
const DB_INDEX = 2

test('Redis instrumentation', async function (t) {
  t.beforeEach(async function (ctx) {
    const agent = helper.instrumentMockedAgent()
    const redis = require('redis')
    const { version } = require('redis/package.json')
    const isV5 = isRedis5Plus(version)
    const args = {
      port: params.redis_port,
      host: params.redis_host
    }

    if (!isV5) {
      args.legacyMode = true
    }

    const client = redis.createClient(args)

    const legacyClient = isV5 ? client.legacy() : client.v4

    await client.connect()
    await legacyCall({ isV5, legacyClient, cmd: 'flushAll' })
    await legacyCall({ isV5, client, legacyClient, cmd: 'select', args: [DB_INDEX] })

    const METRIC_HOST_NAME = urltils.isLocalhost(params.redis_host)
      ? agent.config.getHostnameSafe()
      : params.redis_host
    const HOST_ID = METRIC_HOST_NAME + '/' + params.redis_port

    // need to capture attributes
    agent.config.attributes.enabled = true
    ctx.nr = {
      agent,
      client,
      legacyClient,
      isV5,
      HOST_ID,
      METRIC_HOST_NAME
    }
  })

  t.afterEach(async function (ctx) {
    const { agent, client, legacyClient, isV5 } = ctx.nr
    helper.unloadAgent(agent)
    await legacyCall({ isV5, legacyClient, cmd: 'flushAll' })
    await legacyCall({ isV5, client, legacyClient, cmd: 'quit' })
    // must purge require cache of redis related instrumentation
    // otherwise it will not re-register on subsequent test runs
    removeMatchedModules(/redis/)
  })

  await t.test('should find Redis calls in the transaction trace', function (t, end) {
    const { agent, isV5, legacyClient } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    helper.runInTransaction(agent, async function transactionInScope() {
      const transaction = agent.getTransaction()
      assert.ok(transaction, 'transaction should be visible')

      const ok = await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['testkey', 'arglbargle'] })
      assert.ok(agent.getTransaction(), 'transaction should still be visible')
      assert.ok(ok, 'everything should be peachy after setting')

      const value = await legacyCall({ isV5, legacyClient, cmd: 'get', args: ['testkey'] })
      assert.ok(agent.getTransaction(), 'transaction should still still be visible')
      assert.equal(value, 'arglbargle', 'redis client should still work')

      const trace = transaction.trace
      assert.ok(trace, 'trace should exist')
      assert.ok(trace.root, 'root element should exist')
      const children = trace.getChildren(trace.root.id)
      assert.equal(children.length, 2, 'there should be only two children of the root')

      const [setSegment, getSegment] = children
      const setAttributes = setSegment.getAttributes()
      assert.ok(setSegment, 'trace segment for set should exist')
      assert.equal(setSegment.name, 'Datastore/operation/Redis/set', 'should register the set')
      assert.equal(setAttributes.key, '"testkey"', 'should have the set key as a attribute')
      const setSegmentChildren = trace.getChildren(setSegment.id)
      assert.equal(setSegmentChildren.length, 0, 'set should have no children')

      const getAttributes = getSegment.getAttributes()
      assert.ok(getSegment, 'trace segment for get should exist')

      assert.equal(getSegment.name, 'Datastore/operation/Redis/get', 'should register the get')

      assert.equal(getAttributes.key, '"testkey"', 'should have the get key as a attribute')

      assert.ok(getSegment.timer.hrDuration, 'trace segment should have ended')
      end()
    })
  })

  await t.test('should create correct metrics', function (t, end) {
    const { agent, isV5, legacyClient } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    helper.runInTransaction(agent, async function transactionInScope() {
      const transaction = agent.getTransaction()
      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['testkey', 'arglbargle'] })
      await legacyCall({ isV5, legacyClient, cmd: 'get', args: ['testkey'] })
      transaction.end()
      const metrics = transaction.metrics.unscoped
      const expected = {
        'Datastore/all': 2,
        'Datastore/allWeb': 2,
        'Datastore/Redis/all': 2,
        'Datastore/Redis/allWeb': 2,
        'Datastore/operation/Redis/set': 1,
        'Datastore/operation/Redis/get': 1
      }
      checkMetrics({ metrics, expected })
      end()
    })
  })

  await t.test('should add `key` attribute to trace segment', function (t, end) {
    const { agent, isV5, legacyClient } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    agent.config.attributes.enabled = true

    helper.runInTransaction(agent, async function (tx) {
      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['saveme', 'foobar'] })

      const [segment] = tx.trace.getChildren(agent.tracer.getSegment().id)
      assert.equal(segment.getAttributes().key, '"saveme"', 'should have `key` attribute')
      end()
    })
  })

  await t.test('should not add `key` attribute to trace segment', function (t, end) {
    const { agent, isV5, legacyClient } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    agent.config.attributes.enabled = false

    helper.runInTransaction(agent, async function (tx) {
      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['saveme', 'foobar'] })

      const [segment] = tx.trace.getChildren(agent.tracer.getSegment().id)
      assert.ok(!segment.getAttributes().key, 'should not have `key` attribute')
      end()
    })
  })

  await t.test('should add datastore instance attributes to trace segments', function (t, end) {
    const { agent, isV5, legacyClient, METRIC_HOST_NAME } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    // Enable.
    agent.config.datastore_tracer.instance_reporting.enabled = true
    agent.config.datastore_tracer.database_name_reporting.enabled = true

    helper.runInTransaction(agent, async function transactionInScope() {
      const transaction = agent.getTransaction()
      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['testkey', 'arglbargle'] })

      const trace = transaction.trace
      const [setSegment] = trace.getChildren(trace.root.id)
      const attributes = setSegment.getAttributes()
      assert.equal(attributes.host, METRIC_HOST_NAME, 'should have host as attribute')
      assert.equal(
        attributes.port_path_or_id,
        String(params.redis_port),
        'should have port as attribute'
      )
      assert.equal(
        attributes.database_name,
        String(DB_INDEX),
        'should have database id as attribute'
      )
      assert.equal(attributes.product, 'Redis', 'should have product attribute')
      end()
    })
  })

  await t.test('should not add instance attributes/metrics when disabled', function (t, end) {
    const { agent, isV5, legacyClient, HOST_ID } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    // disable
    agent.config.datastore_tracer.instance_reporting.enabled = false
    agent.config.datastore_tracer.database_name_reporting.enabled = false

    helper.runInTransaction(agent, async function transactionInScope() {
      const transaction = agent.getTransaction()
      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['testkey', 'arglbargle'] })

      const [setSegment] = transaction.trace.getChildren(transaction.trace.root.id)
      const attributes = setSegment.getAttributes()
      assert.equal(attributes.host, undefined, 'should not have host attribute')
      assert.equal(attributes.port_path_or_id, undefined, 'should not have port attribute')
      assert.equal(attributes.database_name, undefined, 'should not have db name attribute')

      transaction.end()
      const unscoped = transaction.metrics.unscoped
      assert.equal(
        unscoped['Datastore/instance/Redis/' + HOST_ID],
        undefined,
        'should not have instance metric'
      )
      end()
    })
  })

  await t.test('should follow selected database', function (t, end) {
    const { agent, isV5, client, legacyClient } = t.nr
    assert.ok(!agent.getTransaction(), 'no transaction should be in play')
    let transaction = null
    const SELECTED_DB = 3
    helper.runInTransaction(agent, async function (tx) {
      transaction = tx
      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['select:test:key', 'foo'] })
      assert.ok(agent.getTransaction(), 'should not lose transaction state')

      await client.select(SELECTED_DB)
      assert.ok(agent.getTransaction(), 'should not lose transaction state')

      await legacyCall({ isV5, legacyClient, cmd: 'set', args: ['select:test:key:2', 'bar'] })
      assert.ok(agent.getTransaction(), 'should not lose transaction state')
      transaction.end()
      verify()
      end()
    })

    function verify() {
      const [setSegment1, selectSegment, setSegment2] = transaction.trace.getChildren(
        transaction.trace.root.id
      )

      assert.equal(
        setSegment1.name,
        'Datastore/operation/Redis/set',
        'should register the first set'
      )
      assert.equal(
        setSegment1.getAttributes().database_name,
        String(DB_INDEX),
        'should have the starting database id as attribute for the first set'
      )
      assert.equal(
        selectSegment.name,
        'Datastore/operation/Redis/select',
        'should register the select'
      )
      assert.equal(
        selectSegment.getAttributes().database_name,
        String(DB_INDEX),
        'should have the starting database id as attribute for the select'
      )
      assert.equal(
        setSegment2.name,
        'Datastore/operation/Redis/set',
        'should register the second set'
      )
      assert.equal(
        setSegment2.getAttributes().database_name,
        String(SELECTED_DB),
        'should have the selected database id as attribute for the second set'
      )
    }
  })
})
