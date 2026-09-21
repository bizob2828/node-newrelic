/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { NrMeter } = require('./nr-meter.js')
const { nowHrTime } = require('../utils/hr-time.js')
const { AggregationTemporality } = require('../constants.js')

/**
 * Implements the `@opentelemetry/api` `MeterProvider` interface without
 * depending on `@opentelemetry/sdk-metrics`.
 *
 * Replaces the private-field hack `provider._sharedState.resource = resource`
 * with the explicit `setResource(attributes)` method.
 *
 * @see https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api.MeterProvider.html
 */
class NrMeterProvider {
  #meters = new Map()
  #resource = { attributes: {} }
  #agent

  constructor({ agent } = {}) {
    this.#agent = agent
  }

  getMeter(name, version = '', _options) {
    this.#agent?.metrics
      .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/getMeter')
      .incrementCallCount()

    const key = `${name}@${version}`
    if (!this.#meters.has(key)) {
      const meter = new NrMeter({ name, version })
      this.#wrapCreateMethods(meter)
      this.#meters.set(key, meter)
    }
    return this.#meters.get(key)
  }

  /**
   * @returns {object} Current resource attributes object.
   */
  get resource() {
    return this.#resource
  }

  /**
   * Updates the resource attributes attached to all metrics from this
   * provider. Replaces the `provider._sharedState.resource` private-access
   * hack used by the sdk-metrics integration.
   *
   * @param {object} attributes Plain key-value resource attributes.
   */
  setResource(attributes) {
    this.#resource = { attributes }
  }

  async collect(temporality = AggregationTemporality.DELTA) {
    const collectTime = nowHrTime()
    const scopeMetrics = []

    for (const meter of this.#meters.values()) {
      const sm = await meter.collect(collectTime, temporality)
      if (sm.metrics.length > 0) scopeMetrics.push(sm)
    }

    return {
      resourceMetrics: { resource: this.#resource, scopeMetrics }
    }
  }

  shutdown() {
    return Promise.resolve()
  }

  // Wrap each create* method so we can track supportability metrics without
  // monkey-patching an external class.
  #wrapCreateMethods(meter) {
    const agent = this.#agent
    if (!agent) return
    const proto = Object.getPrototypeOf(meter)
    for (const method of Object.getOwnPropertyNames(proto)) {
      if (!method.startsWith('create')) continue
      const original = meter[method].bind(meter)
      meter[method] = function nrTrackedCreate(...args) {
        agent.metrics
          .getOrCreateMetric(`Supportability/Metrics/Nodejs/OpenTelemetryBridge/meter/${method}`)
          .incrementCallCount()
        return original(...args)
      }
    }
  }
}

module.exports = NrMeterProvider
