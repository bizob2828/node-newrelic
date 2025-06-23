/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
module.exports = [
  {
    channelName: 'nr_sendCommand',
    module: { name: 'ioredis', versionRange: '>=4', filePath: 'built/Redis.js' },
    operator: 'tracePromise',
    functionQuery: {
      className: 'Redis',
      methodName: 'sendCommand',
      kind: 'Async'
    }
  },
  {
    channelName: 'nr_sendCommand',
    module: { name: 'ioredis', versionRange: '>=4', filePath: 'built/redis.js' },
    operator: 'tracePromise',
    functionQuery: {
      expressionName: 'sendCommand',
      kind: 'Async'
    }
  },
  {
    channelName: 'nr_sendCommand',
    module: { name: 'ioredis', versionRange: '>=4', filePath: 'built/redis/index.js' },
    operator: 'tracePromise',
    functionQuery: {
      expressionName: 'sendCommand',
      kind: 'Async'
    }
  },
  {
    channelName: 'nr_request',
    module: { name: '@elastic/elasticsearch', versionRange: '>=7 <8', filePath: 'lib/Transport.js' },
    operator: 'tracePromise',
    functionQuery: {
      className: 'Transport',
      methodName: 'request',
      kind: 'Sync'
    }
  },
  {
    channelName: 'nr_request',
    module: { name: '@elastic/transport', versionRange: '>=8', filePath: 'lib/Transport.js' },
    operator: 'tracePromise',
    functionQuery: {
      className: 'Transport',
      methodName: 'request',
      kind: 'Async'
    }
  },
]
