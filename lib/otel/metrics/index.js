/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { resourceFromAttributes } = require('./nr-resource.js')
const MeterProvider = require('./sdk/meter-provider.js')
const PeriodicMetricReader = require('./sdk/periodic-metric-reader.js')

const { proxySettingsPresent } = require('#agentlib/collector/http-agents.js')
const defaultLogger = require('../../logger').child({ component: 'opentelemetry-metrics' })
const NROTLPMetricExporter = require('./nr-exporter.js')
const NRCapturingExporter = require('./nr-capturing-exporter.js')
const SetupSignal = require('../setup-signal.js')
const generateProxyAgentFactory = require('./generate-proxy-agent-factory.js')

// See https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
const MAXIMUM_TIMEOUT_TIME = ((2 ** 32) / 2) - 1

class SetupMetrics extends SetupSignal {
  /**
   * @type {PeriodicMetricReader}
   */
  #metricReader

  constructor({ agent, logger = defaultLogger } = {}) {
    super({ agent, logger })

    const { config } = agent

    // When we are in serverless mode, we want to flush the collected metrics
    // ourselves during agent harvest time. So we configure the periodic
    // reader to use an interval that is likely to never occur.
    let exportInterval = agent.serverlessMode === true
      ? MAXIMUM_TIMEOUT_TIME
      : config.opentelemetry.metrics.export_interval
    // We shouldn't need to adjust the timeout time when in serveless mode.
    // We shouldn't ever be issuing an HTTP request via the reader, so its
    // timeout doesn't matter. It just needs to be a valid value.
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

    const resource = resourceFromAttributes({ })
    // No exporter is assigned yet -- the real destination (entity GUID,
    // license key) isn't known until the agent's `started` event fires,
    // below. Until then, the reader simply skips its collection cycles
    // (see sdk/periodic-metric-reader.js), leaving measurements queued
    // rather than exporting them nowhere.
    const reader = new PeriodicMetricReader({
      exportIntervalMillis: exportInterval,
      exportTimeoutMillis: exportTimeout
    })
    // `MeterProvider`/`Meter` track `getMeter`/`create*` Supportability
    // metrics internally (see sdk/meter-provider.js, sdk/meter.js) since we
    // own those classes -- no need to monkey-patch them from out here the
    // way we would have had to with an opaque upstream SDK.
    const provider = new MeterProvider({ reader, resource, agent })
    this.#metricReader = reader

    this.coreApi.metrics.setGlobalMeterProvider(provider)

    agent.metrics
      .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/enabled')
      .incrementCallCount()

    if (agent.serverlessMode === false) {
      // We need access to `agent.config.entity_guid` in order to attach metrics
      // to the correct instrumentation entity. But that value is not available
      // until either at least the first firing of `agent.config.on('change')`, or
      // the `agent.on('started')` event. Which means that we can't finalize the
      // metrics client configuration until after the `started` event.
      logger.debug('Waiting for agent connect to finish bootstrapping OTEL metrics.')
      agent.on('started', postReady)
    } else {
      // In this case, we simply need to assign a capturing exporter to the
      // reader so that we can manually collect metrics when the agent
      // performs a harvest during serverless mode execution.
      logger.debug('Finalizing OTEL metrics in serverless mode.')
      reader.exporter = new NRCapturingExporter({ logger })
      agent.emit('otelMetricsBootstrapped')
    }
    function postReady() {
      logger.debug('Agent connect finished. Finishing boostrap of OTEL metrics.')
      agent.removeListener('started', postReady)

      reader.collect().then(({ resourceMetrics: collectedMetrics }) => {
        const exporterConfig = {
          url: `https://${config.host}:${config.port}/v1/metrics`,
          headers: { 'api-key': config.license_key },
          timeoutMillis: exportTimeout
        }
        if (proxySettingsPresent(agent.config) === true) {
          exporterConfig.httpAgentOptions = generateProxyAgentFactory({
            agentConfig: agent.config,
            logger
          })
        }

        reader.exporter = new NROTLPMetricExporter(
          exporterConfig,
          { agent, logger }
        )

        const resource = resourceFromAttributes({
          'entity.guid': config.entity_guid,
          ...config.otlp_resource_attributes
        })
        // Assigning the resource after having received the `entity.guid`
        // from the server is a key detail of this implementation.
        provider.resource = resource

        // Attempt to ship any metrics recorded prior to the `started` event.
        collectedMetrics.resource = resource
        reader.exporter.export(collectedMetrics, () => {})

        agent.emit('otelMetricsBootstrapped')
      })
    }
  }

  teardown() {
    // Stops the periodic reader's timer (synchronously, before any await
    // inside `shutdown()`) and kicks off a best-effort final flush in the
    // background. Without this, the reader would keep firing on its
    // interval forever after the bridge is torn down.
    const shutdown = this.#metricReader.shutdown()
    this.coreApi.metrics.disable()
    return shutdown
  }

  /**
   * Initiates a manual metrics collection and returns the resulting protobuf
   * array as a Base64 encoded string.
   *
   * @returns {Promise<string>} The encoded metrics data.
   */
  async flushToString() {
    const { resourceMetrics: collectedMetrics } = await this.#metricReader.collect()
    await new Promise((resolve) => {
      this.#metricReader.exporter.export(collectedMetrics, () => {
        resolve()
      })
    })
    return this.#metricReader.exporter.lastSerialization
  }
}

module.exports = SetupMetrics
