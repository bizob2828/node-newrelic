/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
'use strict'

module.exports = {
  when: [
    {
      path: './when/instrumentation',
      instrumentations: [{
        channelName: 'nr_then',
        module: { name: 'when', versionRange: '>=3.7.0', filePath: 'lib/makePromise.js' },
        functionQuery: {
          expressionName: 'then',
          kind: 'Sync'
        }
      }]
    },
  ]
}
