/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const cassandraClientConfig = {
  path: './cassandra-driver/client.js',
  instrumentations: [
    {
      channelName: 'nr__execute',
      module: { name: 'cassandra-driver', versionRange: '>=4.4.0', filePath: 'lib/client.js' }, // not index.js
      functionQuery: {
        className: 'Client',
        functionName: '_execute', // method, methodName, functionName?
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
