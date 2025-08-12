/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const DbQuerySubscriber = require('../db-query')

class CassandraClientSubscriber extends DbQuerySubscriber {
  constructor({ agent, logger }) {
    super({ agent, logger, packageName: 'cassandra-driver', channelName: 'nr__execute', system: 'Cassandra' })
    this.events = ['asyncEnd']
  }

  handler(data, ctx) {
    const { self, arguments: args } = data
    const [command] = args
    this.operation = command.name
    this.setParameters(self, command)
    return super.handler(data, ctx)
  }
}

module.exports = CassandraClientSubscriber
