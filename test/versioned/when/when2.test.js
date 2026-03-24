/*
 * Copyright 2024 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')

const helper = require('../../lib/agent_helper')
const testTransactionState = require('../../lib/promises/transaction-state')

// We cannot use `test.beforeEach` and `test.afterEach` with this suite because
// of the `testTransactionState` waterfall tests. Those setup nested subtests
// which will each execute the `beforeEach`. Due to the singleton nature of
// the mocked agent, this causes cascading failures that would be too difficult
// to resolve.

test('transaction state', async function (t) {
  const agent = helper.instrumentMockedAgent()
  const when = require('when')
  const Promise = when.Promise

  t.after(() => {
    helper.unloadAgent(agent)
  })

  await testTransactionState({ t, agent, Promise, library: when })
})
