/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict'

const modName = '@azure/functions'
const filePath = 'dist/azure-functions.js'
const versionRange = '>=4.7.0'

const generic = {
  path: './azure-functions/index.js',
  instrumentations: [
    {
      channelName: 'nr_generic',
      module: { name: modName, versionRange, filePath },
      functionQuery: {
        functionName: 'generic',
        kind: 'Sync'
      }
    }
  ]
}

const logger = {
  path: './azure-functions/logger.js',
  instrumentations: [
    {
      channelName: 'nr_logger',
      module: { name: modName, versionRange, filePath },
      functionQuery: {
        functionName: 'tryGetCoreApiLazy',
        kind: 'Sync'
      }
    }
  ]
}

module.exports = {
  [modName]: [
    generic,
    logger
  ]
}
