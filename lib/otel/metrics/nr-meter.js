/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { createNoopMeter } = require('@opentelemetry/api')
const { AggregationTemporality } = require('../constants.js')
const { nowHrTime } = require('../utils/hr-time.js')

// Extract the noop base classes from @opentelemetry/api without importing
// from internal paths. All classes come through the public createNoopMeter()
// entry point so our subclasses are guaranteed to satisfy the API interfaces.
const _noop = createNoopMeter()
const NoopMeter = _noop.constructor
const NoopCounter = _noop.createCounter('').constructor
const NoopUpDownCounter = _noop.createUpDownCounter('').constructor
const NoopGauge = _noop.createGauge('').constructor
const NoopHistogram = _noop.createHistogram('').constructor
const NoopObsCounter = _noop.createObservableCounter('').constructor
const NoopObsGauge = _noop.createObservableGauge('').constructor
const NoopObsUpDown = _noop.createObservableUpDownCounter('').constructor

const DEFAULT_HISTOGRAM_BOUNDARIES = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]

function compareKeys(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function attrKey(attributes) {
  if (!attributes || Object.keys(attributes).length === 0) return ''
  return JSON.stringify(Object.entries(attributes).sort(([a], [b]) => compareKeys(a, b)))
}

// ─── Synchronous instruments ─────────────────────────────────────────────────

class NrCounter extends NoopCounter {
  constructor(name, { description = '', unit = '' } = {}) {
    super()
    this.name = name
    this.description = description
    this.unit = unit
    this.type = 'sum'
    this.isMonotonic = true
    this._points = new Map()
  }

  add(amount, attributes = {}) {
    if (typeof amount !== 'number' || amount < 0) return
    const key = attrKey(attributes)
    const pt = this._points.get(key) ?? { value: 0, startTime: nowHrTime(), attributes }
    pt.value += amount
    this._points.set(key, pt)
  }

  collect(collectTime, temporality = AggregationTemporality.DELTA) {
    const points = []
    for (const pt of this._points.values()) {
      points.push({ attributes: pt.attributes, startTime: pt.startTime, collectTime, value: pt.value })
    }
    if (temporality === AggregationTemporality.DELTA) this._points = new Map()
    return points
  }
}

class NrUpDownCounter extends NoopUpDownCounter {
  constructor(name, { description = '', unit = '' } = {}) {
    super()
    this.name = name
    this.description = description
    this.unit = unit
    this.type = 'sum'
    this.isMonotonic = false
    this._points = new Map()
  }

  add(amount, attributes = {}) {
    if (typeof amount !== 'number') return
    const key = attrKey(attributes)
    const pt = this._points.get(key) ?? { value: 0, startTime: nowHrTime(), attributes }
    pt.value += amount
    this._points.set(key, pt)
  }
}

// NrUpDownCounter shares the same collect logic as NrCounter — assign after
// both class definitions to avoid a sonarjs/no-identical-functions violation.
NrUpDownCounter.prototype.collect = NrCounter.prototype.collect

class NrGauge extends NoopGauge {
  constructor(name, { description = '', unit = '' } = {}) {
    super()
    this.name = name
    this.description = description
    this.unit = unit
    this.type = 'gauge'
    this._points = new Map()
  }

  record(value, attributes = {}) {
    if (typeof value !== 'number') return
    this._points.set(attrKey(attributes), { value, attributes, collectTime: nowHrTime() })
  }

  collect(collectTime, temporality = AggregationTemporality.DELTA) {
    const points = []
    for (const pt of this._points.values()) {
      points.push({ attributes: pt.attributes, collectTime, value: pt.value })
    }
    if (temporality === AggregationTemporality.DELTA) this._points = new Map()
    return points
  }
}

class NrHistogram extends NoopHistogram {
  constructor(name, { description = '', unit = '', boundaries = DEFAULT_HISTOGRAM_BOUNDARIES } = {}) {
    super()
    this.name = name
    this.description = description
    this.unit = unit
    this.type = 'histogram'
    this._boundaries = boundaries
    this._points = new Map()
  }

  record(value, attributes = {}) {
    if (typeof value !== 'number') return
    const key = attrKey(attributes)
    let pt = this._points.get(key)
    if (!pt) {
      pt = {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        bucketCounts: new Array(this._boundaries.length + 1).fill(0),
        startTime: nowHrTime(),
        attributes
      }
      this._points.set(key, pt)
    }
    pt.count++
    pt.sum += value
    if (value < pt.min) pt.min = value
    if (value > pt.max) pt.max = value
    const idx = this._boundaries.findIndex((b) => value <= b)
    pt.bucketCounts[idx === -1 ? this._boundaries.length : idx]++
  }

  collect(collectTime, temporality = AggregationTemporality.DELTA) {
    const points = []
    for (const pt of this._points.values()) {
      points.push({
        attributes: pt.attributes,
        startTime: pt.startTime,
        collectTime,
        count: pt.count,
        sum: pt.sum,
        min: pt.min === Infinity ? undefined : pt.min,
        max: pt.max === -Infinity ? undefined : pt.max,
        bucketCounts: [...pt.bucketCounts],
        explicitBounds: this._boundaries
      })
    }
    if (temporality === AggregationTemporality.DELTA) this._points = new Map()
    return points
  }
}

// ─── Observable instruments ───────────────────────────────────────────────────
// Each extends its specific noop base so instanceof checks work correctly.

function makeObservable(Base, type, isMonotonic) {
  return class extends Base {
    constructor(name, { description = '', unit = '' } = {}) {
      super()
      this.name = name
      this.description = description
      this.unit = unit
      this.type = type
      this.isMonotonic = isMonotonic
      this._callbacks = new Set()
      this._pending = []
    }

    addCallback(fn) { this._callbacks.add(fn) }
    removeCallback(fn) { this._callbacks.delete(fn) }

    _addObservation(value, attributes) {
      this._pending.push({ value, attributes: attributes ?? {} })
    }

    // temporality has no effect on observable instruments — callbacks always
    // report the current observed value, so DELTA and CUMULATIVE are identical.
    async collect(collectTime, _temporality) {
      const observations = [...this._pending]
      this._pending = []
      for (const cb of this._callbacks) {
        const result = { observe: (v, attrs) => observations.push({ value: v, attributes: attrs ?? {} }) }
        await Promise.resolve(cb(result))
      }
      return observations.map(({ value, attributes }) => { return { attributes, collectTime, value } })
    }
  }
}

const NrObservableCounter = makeObservable(NoopObsCounter, 'sum', true)
const NrObservableUpDownCounter = makeObservable(NoopObsUpDown, 'sum', false)
const NrObservableGauge = makeObservable(NoopObsGauge, 'gauge', null)

// ─── Meter ───────────────────────────────────────────────────────────────────

class NrMeter extends NoopMeter {
  constructor({ name, version }) {
    super()
    this.instrumentationScope = { name, version }
    this._instruments = new Map()
    this._batchCallbacks = []
  }

  createCounter(name, options) { return this._getOrCreate(name, () => new NrCounter(name, options)) }
  createUpDownCounter(name, options) { return this._getOrCreate(name, () => new NrUpDownCounter(name, options)) }
  createHistogram(name, options) { return this._getOrCreate(name, () => new NrHistogram(name, options)) }
  createGauge(name, options) { return this._getOrCreate(name, () => new NrGauge(name, options)) }
  createObservableCounter(name, options) { return this._getOrCreate(name, () => new NrObservableCounter(name, options)) }
  createObservableUpDownCounter(name, options) { return this._getOrCreate(name, () => new NrObservableUpDownCounter(name, options)) }
  createObservableGauge(name, options) { return this._getOrCreate(name, () => new NrObservableGauge(name, options)) }

  addBatchObservableCallback(callback, observables) {
    this._batchCallbacks.push({ callback, observables })
  }

  removeBatchObservableCallback(callback) {
    this._batchCallbacks = this._batchCallbacks.filter((b) => b.callback !== callback)
  }

  _getOrCreate(name, factory) {
    if (this._instruments.has(name)) return this._instruments.get(name)
    const instrument = factory()
    this._instruments.set(name, instrument)
    return instrument
  }

  async collect(collectTime, temporality = AggregationTemporality.DELTA) {
    for (const { callback } of this._batchCallbacks) {
      const proxy = {
        observe(observable, value, attributes) { observable._addObservation(value, attributes) }
      }
      await Promise.resolve(callback(proxy))
    }

    const metrics = []
    for (const instrument of this._instruments.values()) {
      const points = await instrument.collect(collectTime, temporality)
      if (points.length > 0) {
        metrics.push({
          name: instrument.name,
          description: instrument.description,
          unit: instrument.unit,
          type: instrument.type,
          isMonotonic: instrument.isMonotonic,
          points
        })
      }
    }

    return { scope: this.instrumentationScope, metrics }
  }
}

module.exports = { NrMeter }
