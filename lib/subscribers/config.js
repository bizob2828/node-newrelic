/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * The expected export of these files is:
 *
 * tracing channel based instrumentation defines module.name
 * this is used to set  `config.instrumentations[module.name].enabled`
 *
 * For diagnostics channel based instrumentation you must pass in `moduleName`
 * This is used to set the config `config.instrumentations[moduleName].enabled` flag
 *
 * {
 * path: './express/use.js,
 * instrumentations: [
 * {
 *   channelName: 'nr_route',
 *   module: {
 *     name: 'express',
 *     versionRange: '>=4.15.0',
 *     filePath: 'lib/router/index.js'
 *    },
 *    functionQuery: {
 *     expressionName: 'route',
 *     kind: 'Sync'
 *    }
 *  }
 *  ]
 * },
 * {
 * path: './undici/index.js',
 * moduleName: 'undici',
 * instrumentations: []
 * },
 */
const subscribers = [
  ...require('./amqplib/config'),
  ...require('./bunyan/config'),
  ...require('./cassandra-driver/config'),
  ...require('./elasticsearch/config'),
  ...require('./express/config'),
  ...require('./fastify/config'),
  ...require('./google-genai/config'),
  ...require('./grpcjs/config'),
  ...require('./ioredis/config'),
  ...require('./iovalkey/config'),
  ...require('./langchain/config'),
  ...require('./langgraph/config'),
  ...require('./mcp-sdk/config'),
  ...require('./mysql/config'),
  ...require('./mysql2/config'),
  ...require('./nestjs/config'),
  ...require('./node-redis-client/config'),
  ...require('./openai/config'),
  ...require('./pg/config'),
  ...require('./pino/config'),
  ...require('./q/config'),
  ...require('./redis/config'),
  ...require('./redis-client/config'),
  ...require('./undici/config'),
  ...require('./winston/config')
]

const instrumentations = []
let packages = []

/**
 * Builds a set of packages and instrumentations from a list of subscriber configurations.
 *
 * @param {Array} configurations defaults to the exported configs above
 * @returns {object} { instrumentations, packages } An object containing an array of unique package names and an array of instrumentations.
 */
function formatConfig(configurations = subscribers) {
  if (instrumentations.length > 0 && packages.length > 0) {
    return { instrumentations, packages }
  }

  const pkgsSet = new Set()
  for (const subscriber of configurations) {
    if (subscriber.moduleName) {
      pkgsSet.add(subscriber.moduleName)
    }
    for (const instrumentation of subscriber.instrumentations) {
      instrumentations.push(instrumentation)
      if (instrumentation?.module?.name) {
        pkgsSet.add(instrumentation.module.name)
      }
    }
  }

  packages = Array.from(pkgsSet)
  return { instrumentations, packages }
}

module.exports = {
  subscribers,
  formatConfig
}
