/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const DbQuerySubscriber = require('../db-query')
const queryParser = require('../../db/query-parsers/sql')

class CassandraClientSubscriber extends DbQuerySubscriber {
  constructor({ agent, logger }) {
    super({ agent, logger, packageName: 'cassandra-driver', channelName: 'nr_execute', system: 'Cassandra' })
    this.events = ['asyncEnd']
  }

  handler(data, ctx) {
    const { self, arguments: args } = data
    this.queryString = args?.[0]
    this.setParameters(self)
    return super.handler(data, ctx)
  }
  
  setParameters(self) {
    this.parameters = {}
    this.parameters.product = this.system
    this.parameters.database_name = self?.keyspace
    this.parameters.host = self?.controlConnection?.connection?.address
    this.parameters.port_path_or_id = self?.controlConnection?.connection?.port
  }

  parseQuery(queryString) {
    return queryParser(queryString)
  }
}

module.exports = CassandraClientSubscriber
