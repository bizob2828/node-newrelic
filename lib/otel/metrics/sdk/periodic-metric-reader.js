/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { resourceFromAttributes } = require('../nr-resource.js')
const { aggregate } = require('./metric-aggregator.js')

// Defensive bound on the raw measurement queue (both synchronously recorded
// and observable-polled measurements share this pool). Beyond this, further
// measurements are dropped rather than growing memory unboundedly.
const DEFAULT_MAX_MEASUREMENT_QUEUE_SIZE = 65_536

/**
 * Minimal stand-in for `@opentelemetry/sdk-metrics`' `PeriodicExportingMetricReader`
 * plus its internal aggregation machinery (normally spread across
 * `MetricCollector`/`Accumulation`/`Aggregator` classes). Synchronous
 * instruments push raw measurements into a flat queue; observable
 * instruments are polled only at collection time. All sum/histogram/
 * last-value math happens once per collection cycle in `metric-aggregator.js`,
 * with cross-cycle state (`cumulativeState`/`lastExportedState`) owned here.
 */
class PeriodicMetricReader {
  #exporter
  #exportIntervalMillis
  #exportTimeoutMillis
  #resource
  #measurements = []
  #droppedMeasurementCount = 0
  #cumulativeState = new Map()
  #lastExportedState = new Map()
  #batchCallbacks = []
  #timer = null
  #exportQueue = []
  #isExporting = false

  /**
   * @type {Set<object>} Observable instruments with at least one active
   * callback. Polled synchronously at the start of every collection cycle.
   */
  observableInstruments = new Set()

  /**
   * @param {object} params Constructor parameters.
   * @param {object} [params.exporter] The `PushMetricExporter`-shaped
   * destination for collected metrics. May be omitted and assigned later
   * via the `exporter` setter -- this bridge constructs the reader before
   * it knows the real destination (entity GUID/license key aren't known
   * until the agent's `started` event). Collection cycles are skipped
   * entirely (measurements stay queued, untouched) while no exporter is
   * assigned, so nothing is lost in the meantime.
   * @param {number} params.exportIntervalMillis How often to collect and
   * export, in milliseconds.
   * @param {number} [params.exportTimeoutMillis] Maximum time to wait for
   * one export to complete before giving up on it (the export itself is
   * not cancelled -- this only stops the reader from waiting on it).
   * Defaults to 30 seconds, matching `@opentelemetry/sdk-metrics`'
   * `PeriodicExportingMetricReader` spec default -- without some bound, a
   * misbehaving exporter that never calls back would hang `forceFlush()`/
   * `shutdown()` forever.
   */
  constructor({ exporter, exportIntervalMillis, exportTimeoutMillis = 30_000 } = {}) {
    this.#exporter = exporter
    this.#exportIntervalMillis = exportIntervalMillis
    this.#exportTimeoutMillis = exportTimeoutMillis
    this.#resource = resourceFromAttributes({})
    this.#startTimer()
  }

  get resource() {
    return this.#resource
  }

  set resource(value) {
    this.#resource = value
  }

  get exporter() {
    return this.#exporter
  }

  set exporter(value) {
    this.#exporter = value
  }

  /**
   * Queues a raw measurement from a synchronous instrument. Observable
   * instruments do not call this -- they're polled directly at collection
   * time instead.
   *
   * @param {object} measurement The measurement to queue.
   */
  record(measurement) {
    if (this.#measurements.length >= DEFAULT_MAX_MEASUREMENT_QUEUE_SIZE) {
      this.#droppedMeasurementCount += 1
      return
    }
    this.#measurements.push(measurement)
  }

  addBatchObservableCallback(callback, instruments) {
    this.#batchCallbacks.push({ callback, instruments: new Set(instruments) })
  }

  removeBatchObservableCallback(callback) {
    const index = this.#batchCallbacks.findIndex((entry) => entry.callback === callback)
    if (index !== -1) {
      this.#batchCallbacks.splice(index, 1)
    }
  }

  #pollObservables() {
    const measurements = []

    for (const instrument of this.observableInstruments) {
      measurements.push(...instrument.collect())
    }

    for (const { callback, instruments } of this.#batchCallbacks) {
      const observableResult = {
        observe: (instrument, value, attributes) => {
          if (!instruments.has(instrument)) return
          measurements.push(instrument.createObservation(value, attributes))
        }
      }
      try {
        callback(observableResult)
      } catch {
        // Swallowed intentionally -- a misbehaving batch callback must not
        // prevent collection of other instruments.
      }
    }

    return measurements
  }

  /**
   * Drains the raw measurement queue, polls observable instruments, and
   * aggregates everything collected into OTLP-ready metrics. Does not
   * export -- see `collect()` (no export) and `#collectAndExport()`
   * (collect then export).
   *
   * @returns {object} `{ resource, metrics }`.
   */
  #collectMetrics() {
    const measurements = this.#measurements
    this.#measurements = []
    measurements.push(...this.#pollObservables())

    const metrics = aggregate(measurements, this.#cumulativeState, this.#lastExportedState)
    return { resource: this.#resource, metrics }
  }

  /**
   * Collects currently-pending metrics without exporting them.
   *
   * @returns {Promise<object>} `{ resourceMetrics: { resource, metrics } }`.
   */
  async collect() {
    return { resourceMetrics: this.#collectMetrics() }
  }

  async #collectAndExport() {
    if (!this.#exporter) {
      // Nothing to export to yet -- skip the whole cycle (not just the
      // export call) so pending measurements stay queued, rather than
      // being drained/aggregated and then silently discarded.
      return
    }
    const { resourceMetrics } = await this.collect()
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      if (this.#exportTimeoutMillis > 0) {
        const timeoutHandle = setTimeout(finish, this.#exportTimeoutMillis)
        timeoutHandle.unref?.()
      }
      this.#exporter.export(resourceMetrics, finish)
    })
  }

  #startTimer() {
    this.#timer = setInterval(() => {
      if (!this.#isExporting && this.#exportQueue.length === 0) {
        this.#enqueueExport()
      }
    }, this.#exportIntervalMillis)
    this.#timer.unref?.()
  }

  #enqueueExport() {
    return new Promise((resolve) => {
      this.#exportQueue.push(async () => {
        await this.#collectAndExport()
        resolve()
      })
      this.#drainExportQueue()
    })
  }

  async #drainExportQueue() {
    if (this.#isExporting) return
    this.#isExporting = true
    while (this.#exportQueue.length > 0) {
      const job = this.#exportQueue.shift()
      await job()
    }
    this.#isExporting = false
  }

  forceFlush() {
    return this.#enqueueExport()
  }

  async shutdown() {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
    await this.forceFlush()
    await this.#exporter?.shutdown()
  }
}

module.exports = PeriodicMetricReader
