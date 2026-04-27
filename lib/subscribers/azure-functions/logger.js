/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const Subscriber = require('../base')
const {
  isApplicationLoggingEnabled,
  isLogForwardingEnabled,
  isMetricsEnabled,
  incrementLoggingLinesMetrics
} = require('#agentlib/util/application-logging.js')

// Azure Functions uses 'information' as the context level for context.log and
// context.info and uses 'warning' as the context level for context.warn.
// These map to the NR standard names that LOGGING.LEVELS recognizes ('info', 'warn').
const AZURE_TO_NR_LEVEL = {
  information: 'info',
  warning: 'warn'
}

module.exports = class AzureFunctionsSubscriber extends Subscriber {
  constructor({ agent, logger }) {
    super({ agent, logger, channelName: 'nr_logger', packageName: '@azure/functions' })
    this.logHookRegistered = false
    this.events = ['end']
  }

  end(data) {
    const coreApi = data.result
    this.registerLogHook(coreApi)
  }

  registerLogHook(coreApi) {
    if (this.logHookRegistered) {
      return
    }

    this.logHookRegistered = true

    if (!isApplicationLoggingEnabled(this.agent.config)) {
      this.logger.debug('Application logging not enabled. Not auto capturing logs from Azure Functions.')
      return
    }

    const agent = this.agent

    coreApi.registerHook('log', (context) => {
      const logLevel = AZURE_TO_NR_LEVEL[context.level] ?? context.level ?? 'info'

      if (isLogForwardingEnabled(agent.config, agent)) {
        const meta = agent.getLinkingMetadata(true)

        const logData = {
          message: context.message ?? 'unknown',
          level: logLevel,
          timestamp: Date.now(),
          category: context.category ?? 'user',
          ...meta
        }

        agent.logs.add(logData)
      }

      if (isMetricsEnabled(agent.config)) {
        incrementLoggingLinesMetrics(logLevel, agent.metrics)
      }
    })
  }
}
