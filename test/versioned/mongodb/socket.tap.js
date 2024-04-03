/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const tap = require('tap')
const helper = require('../../lib/agent_helper')
const common = require('./common')
const { COLLECTIONS } = common
const { dropTestCollections, populate } = require('./collection-common')

// The domain socket tests should only be run if there is a domain socket
// to connect to, which only happens if there is a Mongo instance running on
// the same box as these tests.
const domainPath = common.getDomainSocketPath()
const shouldTestDomain = domainPath
tap.test('domain socket', { skip: !shouldTestDomain }, async function (t) {
  const agent = helper.instrumentMockedAgent()
  const METRIC_HOST_NAME = agent.config.getHostnameSafe()
  const METRIC_HOST_PORT = domainPath

  const mongodb = require('mongodb')

  await dropTestCollections(mongodb)
  const res = await common.connect(mongodb, domainPath)
  const { client, db } = res
  const collection = db.collection(COLLECTIONS.collection1)
  await populate(collection)

  t.teardown(async function () {
    await common.close(client, db)
    helper.unloadAgent(agent)
  })

  t.notOk(agent.getTransaction(), 'should not have transaction')
  await helper.runInTransaction(agent, async function (transaction) {
    transaction.name = common.TRANSACTION_NAME
    const data = await collection.findOne({ i: 15 })
    t.equal(data.i, 15)
    const metrics = ['findOne']
    transaction.end()
    const re = new RegExp('^Datastore/instance/MongoDB/' + domainPath)
    const badMetrics = Object.keys(agent.metrics._metrics.unscoped).filter(function (m) {
      return re.test(m)
    })
    t.notOk(badMetrics.length, 'should not use domain path as host name')
    common.checkMetrics(t, agent, METRIC_HOST_NAME, METRIC_HOST_PORT, metrics || [])
  })
})

tap.test('domain socket replica set', { skip: !shouldTestDomain }, async function (t) {
  const agent = helper.instrumentMockedAgent()
  const METRIC_HOST_NAME = agent.config.getHostnameSafe()
  const METRIC_HOST_PORT = domainPath

  const mongodb = require('mongodb')

  await dropTestCollections(mongodb)
  const res = await common.connect(mongodb, domainPath)
  const { client, db } = res
  const collection = db.collection(COLLECTIONS.collection1)
  await populate(collection)

  t.teardown(async function () {
    await common.close(client, db)
    helper.unloadAgent(agent)
  })

  t.notOk(agent.getTransaction(), 'should not have transaction')
  await helper.runInTransaction(agent, async function (transaction) {
    transaction.name = common.TRANSACTION_NAME
    const data = await collection.findOne({ i: 15 })
    t.equal(data.i, 15)
    const metrics = ['findOne']
    transaction.end()
    const re = new RegExp('^Datastore/instance/MongoDB/' + domainPath)
    const badMetrics = Object.keys(agent.metrics._metrics.unscoped).filter(function (m) {
      return re.test(m)
    })
    t.notOk(badMetrics.length, 'should not use domain path as host name')
    common.checkMetrics(t, agent, METRIC_HOST_NAME, METRIC_HOST_PORT, metrics || [])
  })
})
