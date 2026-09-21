/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { AggregationTemporality } = require('../constants.js')

/**
 * Replaces `@opentelemetry/sdk-metrics` `PeriodicExportingMetricReader`.
 *
 * Two responsibilities:
 *  1. Periodic automatic export on `exportIntervalMillis`.
 *  2. On-demand `collect()` used by `SetupMetrics.postReady` and
 *     `flushToString()`.
 */
class NrMetricReader {
  #provider
  #exporter
  #exportIntervalMillis
  #timer

  constructor({ provider, exporter, exportIntervalMillis }) {
    this.#provider = provider
    this.#exporter = exporter
    this.#exportIntervalMillis = exportIntervalMillis
  }

  start() {
    this.#timer = setInterval(() => { this.#flush() }, this.#exportIntervalMillis)
    // Don't keep the process alive solely because of this timer.
    this.#timer.unref?.()
  }

  /**
   * Collects all accumulated metrics from the provider using the temporality
   * preference declared by the current exporter. Does NOT export — callers
   * are responsible for exporting the returned metrics.
   *
   * @returns {Promise<{resourceMetrics: object}>} Collected metrics payload.
   */
  collect() {
    const temporality = this.#exporter.selectAggregationTemporality?.() ?? AggregationTemporality.DELTA
    return this.#provider.collect(temporality)
  }

  shutdown() {
    clearInterval(this.#timer)
    return Promise.resolve()
  }

  async #flush() {
    const { resourceMetrics } = await this.collect()
    await new Promise((resolve) => {
      this.#exporter.export(resourceMetrics, () => resolve())
    })
  }
}

module.exports = NrMetricReader
