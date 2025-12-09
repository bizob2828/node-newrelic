/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

module.exports = {
  winston: [{
    path: './winston/create-logger.js',
    instrumentations: [
      {
        channelName: 'nr_loggerAdd',
        module: { name: 'winston', versionRange: '>=3.0.0', filePath: 'lib/winston/logger.js' },
        functionQuery: {
          className: 'Logger', 
          methodName: 'configure',
          kind: 'Sync'
        }
      }
    ]
  }]
}
