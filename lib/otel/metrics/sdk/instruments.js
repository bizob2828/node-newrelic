/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { InstrumentType } = require('../../constants.js')
const { sanitizeAttributes } = require('./sanitize-attributes.js')
const { nowUnixNano } = require('./time.js')

/**
 * Base class for all instruments. Instruments themselves are stateless --
 * `add()`/`record()` just builds a plain measurement object and hands it to
 * the owning `PeriodicMetricReader`, which owns all aggregation state.
 */
class Instrument {
  /**
   * @param {string} name Instrument name.
   * @param {object} [options] Instrument options.
   * @param {string} [options.description] Instrument description.
   * @param {string} [options.unit] Instrument unit.
   * @param {object} instrumentationScope The `Meter`'s instrumentation scope.
   * @param {object} reader The `PeriodicMetricReader` that owns this instrument.
   */
  constructor(name, options = {}, instrumentationScope, reader) {
    this.name = name
    this.description = options.description ?? ''
    this.unit = options.unit ?? ''
    this.instrumentationScope = instrumentationScope
    this.reader = reader
  }

  /**
   * Builds a plain measurement object for the reader to aggregate.
   *
   * @param {string} type One of the `InstrumentType` constants.
   * @param {number} value The recorded value.
   * @param {object} [attributes] Attributes to attach to the measurement.
   * @returns {object} The measurement.
   */
  createMeasurement(type, value, attributes = {}) {
    return {
      name: this.name,
      description: this.description,
      unit: this.unit,
      instrumentationScope: this.instrumentationScope,
      type,
      value,
      attributes: sanitizeAttributes(attributes),
      timestamp: nowUnixNano()
    }
  }
}

class Counter extends Instrument {
  add(value, attributes) {
    if (value < 0) return
    this.reader.record(this.createMeasurement(InstrumentType.COUNTER, value, attributes))
  }
}

class UpDownCounter extends Instrument {
  add(value, attributes) {
    this.reader.record(this.createMeasurement(InstrumentType.UP_DOWN_COUNTER, value, attributes))
  }
}

class Histogram extends Instrument {
  record(value, attributes) {
    if (value < 0) return
    this.reader.record(this.createMeasurement(InstrumentType.HISTOGRAM, value, attributes))
  }
}

class Gauge extends Instrument {
  record(value, attributes) {
    this.reader.record(this.createMeasurement(InstrumentType.GAUGE, value, attributes))
  }
}

/**
 * Base class for the three observable (callback-based) instruments.
 * Registers itself into the reader's `observableInstruments` set once it
 * has at least one callback, so the reader can poll it synchronously at
 * collection time. Callbacks are always invoked synchronously -- there is
 * no support for async/Promise-returning callbacks, matching this bridge's
 * other intentional spec simplifications (no Views, no exponential
 * histograms, no exemplars).
 */
class ObservableInstrument extends Instrument {
  #type
  #callbacks = []

  constructor(type, name, options, instrumentationScope, reader) {
    super(name, options, instrumentationScope, reader)
    this.#type = type
  }

  addCallback(callback) {
    this.#callbacks.push(callback)
    this.reader.observableInstruments.add(this)
  }

  removeCallback(callback) {
    const index = this.#callbacks.indexOf(callback)
    if (index === -1) return
    this.#callbacks.splice(index, 1)
    if (this.#callbacks.length === 0) {
      this.reader.observableInstruments.delete(this)
    }
  }

  /**
   * Builds a measurement for this instrument's own type. Used by both
   * `collect()` below and the reader's batch-observable-callback path,
   * which needs to build a measurement for an arbitrary observable
   * instrument without reaching into its private `#type` field.
   *
   * @param {number} value The observed value.
   * @param {object} [attributes] Attributes to attach to the measurement.
   * @returns {object} The measurement.
   */
  createObservation(value, attributes) {
    return this.createMeasurement(this.#type, value, attributes)
  }

  /**
   * Synchronously invokes every registered callback and collects the
   * resulting measurements. A callback that throws is skipped -- a single
   * misbehaving callback must not prevent collection of other instruments.
   *
   * @returns {object[]} Measurements observed during this collection cycle.
   */
  collect() {
    const observations = []
    const observableResult = {
      observe: (value, attributes) => {
        observations.push(this.createObservation(value, attributes))
      }
    }
    for (const callback of this.#callbacks) {
      try {
        callback(observableResult)
      } catch {
        // Swallowed intentionally -- see class doc comment.
      }
    }
    return observations
  }
}

class ObservableCounter extends ObservableInstrument {
  constructor(name, options, instrumentationScope, reader) {
    super(InstrumentType.OBSERVABLE_COUNTER, name, options, instrumentationScope, reader)
  }
}

class ObservableGauge extends ObservableInstrument {
  constructor(name, options, instrumentationScope, reader) {
    super(InstrumentType.OBSERVABLE_GAUGE, name, options, instrumentationScope, reader)
  }
}

class ObservableUpDownCounter extends ObservableInstrument {
  constructor(name, options, instrumentationScope, reader) {
    super(InstrumentType.OBSERVABLE_UP_DOWN_COUNTER, name, options, instrumentationScope, reader)
  }
}

module.exports = {
  Counter,
  UpDownCounter,
  Histogram,
  Gauge,
  ObservableInstrument,
  ObservableCounter,
  ObservableGauge,
  ObservableUpDownCounter
}
