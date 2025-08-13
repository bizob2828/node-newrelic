/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const cassandraClientConfig = {
  path: './cassandra-driver/client.js',
  instrumentations: [
    {
      channelName: 'nr_execute',
      module: { name: 'cassandra-driver', versionRange: '>=4.4.0', filePath: 'lib/client.js' },
      functionQuery: {
        expressionName: 'execute',
        kind: 'Async'
      }
    }
  ]
}

module.exports = {
  'cassandra-driver': [
    cassandraClientConfig
  ]
}
