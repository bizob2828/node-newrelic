/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const Meter = require('./meter.js')

/**
 * Minimal stand-in for `@opentelemetry/sdk-metrics`' `MeterProvider`.
 * Unlike upstream, this holds exactly one reader rather than an array --
 * this bridge has only ever exported to a single destination at a time, so
 * there's no need to reimplement upstream's N-reader fan-out.
 *
 * `resource` is exposed as a plain, directly-settable property (forwarded
 * onto the reader, which is what actually assembles the OTLP-shaped
 * payload at collection time). This replaces the need to reach into a
 * private/internal field to update the resource after construction, which
 * the real `@opentelemetry/sdk-metrics` package required.
 */
class MeterProvider {
  #meters = new Map()
  #agent

  /**
   * @param {object} [params] Constructor parameters.
   * @param {object} params.reader The single `PeriodicMetricReader` this
   * provider's meters record into.
   * @param {object} [params.resource] Initial resource to attach.
   * @param {object} [params.agent] Current agent instance, forwarded to
   * every `Meter` this provider creates so `create*` calls can be tracked
   * as Supportability metrics. When omitted, no tracking happens -- useful
   * for tests exercising only the provider/meter/instrument logic.
   */
  constructor({ reader, resource, agent } = {}) {
    this.reader = reader
    this.#agent = agent
    if (resource !== undefined) {
      this.reader.resource = resource
    }
  }

  get resource() {
    return this.reader.resource
  }

  set resource(value) {
    this.reader.resource = value
  }

  /**
   * @param {string} name Instrumentation scope name.
   * @param {string} [version] Instrumentation scope version.
   * @param {object} [options] Instrumentation scope options.
   * @param {string} [options.schemaUrl] Instrumentation scope schema URL.
   * @param {object} [options.attributes] Instrumentation scope attributes.
   * @returns {Meter} The (possibly cached) `Meter` for this scope.
   */
  getMeter(name, version = '', { schemaUrl = '', attributes = {} } = {}) {
    this.#agent?.metrics
      .getOrCreateMetric('Supportability/Metrics/Nodejs/OpenTelemetryBridge/getMeter')
      .incrementCallCount()

    const key = `${name}@${version}@${schemaUrl}`
    let meter = this.#meters.get(key)
    if (!meter) {
      meter = new Meter(this, { name, version, schemaUrl, attributes }, this.#agent)
      this.#meters.set(key, meter)
    }
    return meter
  }

  shutdown(done) {
    return this.reader.shutdown(done)
  }
}

module.exports = MeterProvider
