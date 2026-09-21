/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const https = require('node:https')
const { AggregationTemporality, ExportResultCode } = require('../constants.js')
const NrJsonSerializer = require('./nr-json-serializer.js')
const defaultLogger = require('#agentlib/logger.js').child({
  component: 'nr-otlp-http-exporter'
})

/**
 * Sends NR-owned `ResourceMetrics` to the New Relic OTLP endpoint using
 * JSON-format OTLP (`Content-Type: application/json`).
 *
 * Replaces `NROTLPMetricExporter` (which extended OTLPMetricExporterBase),
 * `NRProxyingDelegate`, and `NRProxyingSerializer` — the audit logging and
 * success/failure supportability metrics that those classes provided are
 * consolidated here.
 */
class NrOtlpHttpExporter {
  #hostname
  #port
  #path
  #headers
  #httpAgentFactory
  #cachedHttpsAgent = null
  #serializer
  #agent
  #logger

  /**
   * @param {object} config Exporter configuration.
   * @param {string} config.url         Full OTLP endpoint URL.
   * @param {object} [config.headers]   Extra HTTP headers (e.g. `api-key`).
   * @param {function(): object} [config.httpAgentOptions]  Factory that returns an
   *   `https.Agent`, used for proxy support.
   * @param {object} [deps] Local dependency injections.
   * @param {object} [deps.agent]       NR agent instance (for supportability).
   * @param {object} [deps.logger]      Agent logger.
   */
  constructor({ url, headers = {}, httpAgentOptions } = {}, { agent, logger = defaultLogger } = {}) {
    const parsed = new URL(url)
    this.#hostname = parsed.hostname
    this.#port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    this.#path = parsed.pathname
    this.#headers = headers
    this.#httpAgentFactory = httpAgentOptions ?? null
    this.#agent = agent
    this.#logger = logger.child({ subcomponent: this.constructor.name })
    this.#serializer = new NrJsonSerializer({
      destinationUrl: `https://${this.#hostname}:${this.#port}${this.#path}`,
      logger: this.#logger
    })
  }

  export(nrResourceMetrics, callback) {
    const hasData = (nrResourceMetrics.scopeMetrics ?? []).some((sm) => sm.metrics?.length > 0)
    if (!hasData) {
      this.#agent?.metrics
        .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/export/success')
        .incrementCallCount()
      callback({ code: ExportResultCode.SUCCESS })
      return
    }

    const body = this.#serializer.serializeRequest(nrResourceMetrics)
    const buffer = Buffer.from(body)

    const options = {
      hostname: this.#hostname,
      port: this.#port,
      path: this.#path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': buffer.byteLength,
        ...this.#headers
      },
      agent: this.#getAgent()
    }

    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        this.#serializer.deserializeResponse(Buffer.concat(chunks))

        const code = res.statusCode >= 200 && res.statusCode < 300
          ? ExportResultCode.SUCCESS
          : ExportResultCode.FAILED

        this.#logger.audit('Received metrics export result code: %s', code)

        if (code === ExportResultCode.SUCCESS) {
          this.#agent?.metrics
            .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/export/success')
            .incrementCallCount()
        } else {
          this.#agent?.metrics
            .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/export/failure')
            .incrementCallCount()
        }

        callback({ code })
      })
    })

    req.on('error', (err) => {
      this.#logger.warn('OTLP metrics export failed: %s', err.message)
      this.#agent?.metrics
        .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/export/failure')
        .incrementCallCount()
      callback({ code: ExportResultCode.FAILED, error: err })
    })

    req.write(buffer)
    req.end()
  }

  selectAggregationTemporality() { return AggregationTemporality.DELTA }

  // Create the agent once and reuse it so keep-alive connections are shared
  // across requests and proxy tunnels are established only once.
  #getAgent() {
    if (!this.#httpAgentFactory) return undefined
    this.#cachedHttpsAgent ??= this.#httpAgentFactory()
    return this.#cachedHttpsAgent
  }

  forceFlush() { return Promise.resolve() }
  shutdown() { return Promise.resolve() }
}

module.exports = NrOtlpHttpExporter
