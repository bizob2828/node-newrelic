/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { proxySettingsPresent } = require('#agentlib/collector/http-agents.js')
const defaultLogger = require('../../logger').child({ component: 'opentelemetry-metrics' })
const NrMeterProvider = require('./nr-meter-provider.js')
const NrMetricReader = require('./nr-metric-reader.js')
const NrOtlpHttpExporter = require('./nr-otlp-http-exporter.js')
const NRCapturingExporter = require('./nr-capturing-exporter.js')
const SetupSignal = require('../setup-signal.js')
const ProxyingExporter = require('./proxying-exporter.js')
const generateProxyAgentFactory = require('./generate-proxy-agent-factory.js')

// See https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const MAXIMUM_TIMEOUT_TIME = ((2 ^ 32) / 2) - 1

// Pre-bootstrap sink: accepts exports silently until the real exporter is ready.
class NrNoopExporter {
  export(_, callback) { callback({ code: 0 }) }
  forceFlush() { return Promise.resolve() }
  shutdown() { return Promise.resolve() }
}

class SetupMetrics extends SetupSignal {
  /**
   * @type {ProxyingExporter}
   */
  #metricExporter

  /**
   * @type {NrMetricReader}
   */
  #metricReader

  constructor({ agent, logger = defaultLogger } = {}) {
    super({ agent, logger })

    const { config } = agent

    let exportInterval = agent.serverlessMode === true
      ? MAXIMUM_TIMEOUT_TIME
      : config.opentelemetry.metrics.export_interval
    let exportTimeout = config.opentelemetry.metrics.export_timeout
    if (exportInterval <= exportTimeout) {
      logger.warn(
        'opentelemetry.metrics.export_interval (%d) must be greater than export_timeout (%d). ' +
        'Using default values: export_interval=60000, export_timeout=10000',
        exportInterval,
        exportTimeout
      )
      exportInterval = 60_000
      exportTimeout = 10_000
    }

    const proxyExporter = new ProxyingExporter({ exporter: new NrNoopExporter() })
    const provider = new NrMeterProvider({ agent })
    const reader = new NrMetricReader({
      provider,
      exporter: proxyExporter,
      exportIntervalMillis: exportInterval,
      exportTimeoutMillis: exportTimeout
    })
    reader.start()

    this.#metricExporter = proxyExporter
    this.#metricReader = reader

    this.coreApi.metrics.setGlobalMeterProvider(provider)

    agent.metrics
      .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/enabled')
      .incrementCallCount()

    if (agent.serverlessMode === false) {
      logger.debug('Waiting for agent connect to finish bootstrapping OTEL metrics.')
      agent.on('started', postReady)
    } else {
      logger.debug('Finalizing OTEL metrics in serverless mode.')
      proxyExporter.exporter = new NRCapturingExporter({ logger })
      agent.emit('otelMetricsBootstrapped')
    }

    function postReady() {
      logger.debug('Agent connect finished. Finishing bootstrap of OTEL metrics.')
      agent.removeListener('started', postReady)

      reader.collect().then(({ resourceMetrics: collectedMetrics }) => {
        const exporterConfig = {
          url: `https://${config.host}:${config.port}/v1/metrics`,
          headers: { 'api-key': config.license_key }
        }
        if (proxySettingsPresent(agent.config) === true) {
          exporterConfig.httpAgentOptions = generateProxyAgentFactory({
            agentConfig: agent.config,
            logger
          })
        }

        proxyExporter.exporter = new NrOtlpHttpExporter(exporterConfig, { agent, logger })

        // Replace the empty pre-bootstrap resource with one that includes
        // entity.guid — the clean alternative to the former
        // `provider._sharedState.resource = resource` private-field hack.
        provider.setResource({
          'entity.guid': config.entity_guid,
          ...config.otlp_resource_attributes
        })

        // Retroactively stamp the just-collected pre-bootstrap metrics with
        // the entity.guid so they land on the correct entity.
        collectedMetrics.resource = {
          attributes: {
            'entity.guid': config.entity_guid,
            ...config.otlp_resource_attributes
          }
        }
        proxyExporter.exporter.export(collectedMetrics, () => {})

        agent.emit('otelMetricsBootstrapped')
      })
    }
  }

  teardown() {
    this.coreApi.metrics.disable()
  }

  /**
   * Initiates a manual metrics collection and returns the resulting JSON
   * payload as a Base64 encoded string. Used in serverless mode.
   *
   * @returns {Promise<string>} Base64 encoded OTLP JSON.
   */
  async flushToString() {
    const { resourceMetrics: collectedMetrics } = await this.#metricReader.collect()
    await new Promise((resolve) => {
      this.#metricExporter.exporter.export(collectedMetrics, () => resolve())
    })
    return this.#metricExporter.exporter.lastSerialization
  }
}

module.exports = SetupMetrics
