/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { keepAliveAgent } = require('#agentlib/collector/http-agents.js')
const { ExportResultCode } = require('../constants.js')
const defaultLogger = require('#agentlib/logger.js').child({
  component: 'nr-otlp-metric-exporter'
})
const NRProxyingDelegate = require('./nr-proxying-delegate.js')
const NRProxyingSerializer = require('./nr-proxying-serializer.js')
const NrHttpTransport = require('./nr-http-transport.js')

/**
 * Provides the functionality of upstream's `OTLPMetricExporter`, but wraps
 * the internal objects so that we can write audit logs.
 */
class NROTLPMetricExporter {
  #delegate

  /**
   * @param {object} config Exporter configuration.
   * @param {string} config.url Destination URL to POST serialized metrics to.
   * @param {object} [config.headers] Headers to send with every request.
   * @param {Function} [config.httpAgentOptions] Factory function returning
   * an `http.Agent`/`https.Agent` instance to use. Falls back to the agent's
   * shared keep-alive agent when absent.
   * @param {number} [config.timeoutMillis] Overall deadline for a single
   * export, including retries.
   * @param {object} deps Local dependency injections.
   * @param {object} deps.agent Current agent instance.
   * @param {AgentLogger} deps.logger Agent logger instance.
   */
  constructor(config = {}, { agent, logger = defaultLogger } = {}) {
    const headers = { ...config.headers, 'Content-Type': 'application/x-protobuf' }
    const agentFactory = typeof config.httpAgentOptions === 'function'
      ? config.httpAgentOptions
      : keepAliveAgent

    const serializer = new NRProxyingSerializer({ destinationUrl: config.url, logger })
    const transport = new NrHttpTransport({
      url: config.url,
      headers,
      agentFactory,
      timeoutMillis: config.timeoutMillis
    })

    const delegate = {
      export(items, resultCallback) {
        const serialized = serializer.serializeRequest(items)
        transport.send(serialized).then(
          (data) => {
            try {
              serializer.deserializeResponse(data)
            } catch {
              // Response body is only used for audit logging; a malformed
              // or empty body doesn't affect export success.
            }
            resultCallback({ code: ExportResultCode.SUCCESS })
          },
          (error) => {
            resultCallback({ code: ExportResultCode.FAILED, error })
          }
        )
      },
      forceFlush() { return Promise.resolve() },
      shutdown() { return Promise.resolve() }
    }

    this.#delegate = new NRProxyingDelegate(delegate, { agent, logger })
  }

  export(items, resultCallback) {
    this.#delegate.export(items, resultCallback)
  }

  forceFlush() {
    return this.#delegate.forceFlush()
  }

  shutdown() {
    return this.#delegate.shutdown()
  }
}

module.exports = NROTLPMetricExporter
