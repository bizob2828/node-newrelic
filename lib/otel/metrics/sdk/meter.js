/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { InstrumentType } = require('../../constants.js')
const {
  Counter,
  UpDownCounter,
  Histogram,
  Gauge,
  ObservableCounter,
  ObservableGauge,
  ObservableUpDownCounter
} = require('./instruments.js')

/**
 * Minimal stand-in for `@opentelemetry/sdk-metrics`' `Meter`. Caches
 * instruments by type+name (case-insensitive) and hands every instrument a
 * direct reference to the owning `MeterProvider`'s single reader, which is
 * where all aggregation state actually lives.
 */
class Meter {
  #meterProvider
  #instrumentationScope
  #agent
  #instruments = new Map()

  /**
   * @param {object} meterProvider The owning `MeterProvider`.
   * @param {object} instrumentationScope This meter's instrumentation scope.
   * @param {object} [agent] Current agent instance. When present, every
   * `create*` call is tracked as a Supportability metric
   * (`.../meter/<methodName>`), on every call -- not deduped by instrument
   * identity, matching this bridge's existing usage-tracking semantics.
   */
  constructor(meterProvider, instrumentationScope, agent) {
    this.#meterProvider = meterProvider
    this.#instrumentationScope = instrumentationScope
    this.#agent = agent
  }

  #trackCreateCall(methodName) {
    this.#agent?.metrics
      .getOrCreateMetric(`Supportability/Metrics/Nodejs/OpenTelemetryBridge/meter/${methodName}`)
      .incrementCallCount()
  }

  #getOrCreateInstrument(name, type, InstrumentClass, options) {
    const key = `${type}:${name.toLowerCase()}`
    let instrument = this.#instruments.get(key)
    if (!instrument) {
      instrument = new InstrumentClass(
        name,
        options,
        this.#instrumentationScope,
        this.#meterProvider.reader
      )
      this.#instruments.set(key, instrument)
    }
    return instrument
  }

  createCounter(name, options) {
    this.#trackCreateCall('createCounter')
    return this.#getOrCreateInstrument(name, InstrumentType.COUNTER, Counter, options)
  }

  createUpDownCounter(name, options) {
    this.#trackCreateCall('createUpDownCounter')
    return this.#getOrCreateInstrument(name, InstrumentType.UP_DOWN_COUNTER, UpDownCounter, options)
  }

  createHistogram(name, options) {
    this.#trackCreateCall('createHistogram')
    return this.#getOrCreateInstrument(name, InstrumentType.HISTOGRAM, Histogram, options)
  }

  createGauge(name, options) {
    this.#trackCreateCall('createGauge')
    return this.#getOrCreateInstrument(name, InstrumentType.GAUGE, Gauge, options)
  }

  createObservableCounter(name, options) {
    this.#trackCreateCall('createObservableCounter')
    return this.#getOrCreateInstrument(
      name,
      InstrumentType.OBSERVABLE_COUNTER,
      ObservableCounter,
      options
    )
  }

  createObservableGauge(name, options) {
    this.#trackCreateCall('createObservableGauge')
    return this.#getOrCreateInstrument(
      name,
      InstrumentType.OBSERVABLE_GAUGE,
      ObservableGauge,
      options
    )
  }

  createObservableUpDownCounter(name, options) {
    this.#trackCreateCall('createObservableUpDownCounter')
    return this.#getOrCreateInstrument(
      name,
      InstrumentType.OBSERVABLE_UP_DOWN_COUNTER,
      ObservableUpDownCounter,
      options
    )
  }

  addBatchObservableCallback(callback, instruments) {
    this.#meterProvider.reader.addBatchObservableCallback(callback, instruments)
  }

  removeBatchObservableCallback(callback) {
    this.#meterProvider.reader.removeBatchObservableCallback(callback)
  }
}

module.exports = Meter
