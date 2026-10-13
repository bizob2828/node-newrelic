/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { AggregationTemporality, InstrumentType } = require('../../constants.js')
const { stableStringify } = require('../stable-stringify.js')

// Identical to `@opentelemetry/sdk-metrics`' own default explicit bucket
// boundaries (milliseconds-scale), so adopting a hand-written histogram
// aggregator here is not an observable behavior change.
const DEFAULT_HISTOGRAM_BUCKETS = [
  0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10_000
]

function scopeKeyFor(scope) {
  return `${scope.name}@${scope.version}@${scope.schemaUrl}`
}

function pickTemporality(type) {
  switch (type) {
    case InstrumentType.COUNTER:
    case InstrumentType.OBSERVABLE_COUNTER:
    case InstrumentType.HISTOGRAM:
      return AggregationTemporality.DELTA
    case InstrumentType.UP_DOWN_COUNTER:
    case InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
      return AggregationTemporality.CUMULATIVE
    default:
      // GAUGE / OBSERVABLE_GAUGE have no aggregation temporality concept.
      return undefined
  }
}

function isMonotonicType(type) {
  return type === InstrumentType.COUNTER || type === InstrumentType.OBSERVABLE_COUNTER
}

function getOrCreateMetric(metrics, metricKey, measurement) {
  let metric = metrics.get(metricKey)
  if (!metric) {
    metric = {
      name: measurement.name,
      description: measurement.description,
      unit: measurement.unit,
      instrumentationScope: measurement.instrumentationScope,
      type: measurement.type,
      temporality: pickTemporality(measurement.type),
      isMonotonic: isMonotonicType(measurement.type),
      dataPoints: new Map()
    }
    metrics.set(metricKey, metric)
  }
  return metric
}

/**
 * Sum aggregation, used for Counter/UpDownCounter (synchronous: each
 * measurement is an increment, so the running total accumulates via `+=`)
 * and ObservableCounter/ObservableUpDownCounter (asynchronous: each
 * callback reports the current absolute total directly, so the running
 * total is simply overwritten).
 *
 * @param {object} metric The in-progress aggregated metric to add a data point to.
 * @param {object} measurement The raw measurement being folded in.
 * @param {string} attrKey The measurement's attribute-set cache key.
 * @param {string} stateKey The cross-cycle cumulative-state cache key.
 * @param {Map} cumulativeState Running totals, persisted across cycles.
 * @param {boolean} accumulate `true` to add to the running total (synchronous
 * instruments); `false` to overwrite it with the latest observed value
 * (asynchronous/observable instruments).
 */
function aggregateSum(metric, measurement, attrKey, stateKey, cumulativeState, accumulate) {
  let state = cumulativeState.get(stateKey)
  if (!state) {
    state = { value: 0, startTimeUnixNano: measurement.timestamp }
    cumulativeState.set(stateKey, state)
  }
  state.value = accumulate ? state.value + measurement.value : measurement.value

  metric.dataPoints.set(attrKey, {
    attributes: measurement.attributes,
    value: state.value,
    startTimeUnixNano: state.startTimeUnixNano,
    timeUnixNano: measurement.timestamp
  })
}

function aggregateHistogram(metric, measurement, attrKey, stateKey, cumulativeState) {
  let state = cumulativeState.get(stateKey)
  if (!state) {
    state = {
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      bucketCounts: new Array(DEFAULT_HISTOGRAM_BUCKETS.length + 1).fill(0),
      startTimeUnixNano: measurement.timestamp
    }
    cumulativeState.set(stateKey, state)
  }

  let bucketIndex = DEFAULT_HISTOGRAM_BUCKETS.length
  for (let i = 0; i < DEFAULT_HISTOGRAM_BUCKETS.length; i++) {
    if (measurement.value <= DEFAULT_HISTOGRAM_BUCKETS[i]) {
      bucketIndex = i
      break
    }
  }
  state.bucketCounts[bucketIndex] += 1
  state.count += 1
  state.sum += measurement.value
  state.min = Math.min(state.min, measurement.value)
  state.max = Math.max(state.max, measurement.value)

  metric.dataPoints.set(attrKey, {
    attributes: measurement.attributes,
    count: state.count,
    sum: state.sum,
    min: state.min,
    max: state.max,
    bucketCounts: state.bucketCounts.slice(),
    explicitBounds: DEFAULT_HISTOGRAM_BUCKETS,
    startTimeUnixNano: state.startTimeUnixNano,
    timeUnixNano: measurement.timestamp
  })
}

/**
 * Last-value aggregation, used for Gauge/ObservableGauge. There is no
 * cumulative state and no temporality -- whichever measurement for a given
 * attribute set arrives last within the collection cycle wins.
 *
 * @param {object} metric The in-progress aggregated metric to add a data point to.
 * @param {object} measurement The raw measurement being folded in.
 * @param {string} attrKey The measurement's attribute-set cache key.
 */
function aggregateLastValue(metric, measurement, attrKey) {
  metric.dataPoints.set(attrKey, {
    attributes: measurement.attributes,
    value: measurement.value,
    timeUnixNano: measurement.timestamp
  })
}

/**
 * Converts cumulative running totals into delta-since-last-export values,
 * for the instrument types whose temporality is DELTA (Counter,
 * ObservableCounter, Histogram). UpDownCounter/ObservableUpDownCounter stay
 * cumulative, and Gauge/ObservableGauge have no temporality at all, so
 * neither is touched here. `cumulativeState` is left untouched -- it keeps
 * growing monotonically for the life of the reader; only `lastExportedState`
 * is updated, as the baseline for the next delta subtraction.
 *
 * Per OTel's own `HistogramAggregator.diff()` behavior, delta histogram
 * data points omit `min`/`max` entirely, since subtracting two cumulative
 * minimums/maximums does not produce a meaningful delta minimum/maximum.
 *
 * @param {Map} metrics This cycle's aggregated metrics, keyed by metric key.
 * @param {Map} lastExportedState Previous export's cumulative snapshot, used
 * as the delta-subtraction baseline. Mutated in place.
 */
function applyDeltaTemporality(metrics, lastExportedState) {
  for (const [metricKey, metric] of metrics) {
    if (metric.temporality !== AggregationTemporality.DELTA) continue

    for (const [attrKey, dataPoint] of metric.dataPoints) {
      const stateKey = `${metricKey}:${attrKey}`

      if (metric.type === InstrumentType.HISTOGRAM) {
        const last = lastExportedState.get(stateKey) ?? {
          count: 0,
          sum: 0,
          bucketCounts: new Array(dataPoint.bucketCounts.length).fill(0)
        }
        const deltaBucketCounts = dataPoint.bucketCounts.map(
          (count, i) => count - (last.bucketCounts[i] ?? 0)
        )
        lastExportedState.set(stateKey, {
          count: dataPoint.count,
          sum: dataPoint.sum,
          bucketCounts: dataPoint.bucketCounts.slice()
        })
        dataPoint.count -= last.count
        dataPoint.sum -= last.sum
        dataPoint.bucketCounts = deltaBucketCounts
        delete dataPoint.min
        delete dataPoint.max
      } else {
        const lastValue = lastExportedState.get(stateKey) ?? 0
        const cumulativeValue = dataPoint.value
        lastExportedState.set(stateKey, cumulativeValue)
        dataPoint.value = cumulativeValue - lastValue
      }
    }
  }
}

/**
 * Aggregates a batch of raw measurements into OTLP-ready metrics, folding
 * in cross-cycle cumulative/delta state.
 *
 * @param {object[]} measurements Raw measurements collected this cycle.
 * @param {Map} cumulativeState Running totals, keyed by
 * `${scopeKey}:${name}:${type}:${attrKey}`. Persists across calls.
 * @param {Map} lastExportedState Previous export's cumulative snapshot,
 * used as the delta-subtraction baseline. Persists across calls.
 * @returns {Map<string, object>} Aggregated metrics keyed by
 * `${scopeKey}:${name}:${type}`.
 */
function aggregate(measurements, cumulativeState, lastExportedState) {
  const metrics = new Map()

  for (const measurement of measurements) {
    const scopeKey = scopeKeyFor(measurement.instrumentationScope)
    const metricKey = `${scopeKey}:${measurement.name}:${measurement.type}`
    const attrKey = stableStringify(measurement.attributes)
    const stateKey = `${metricKey}:${attrKey}`

    const metric = getOrCreateMetric(metrics, metricKey, measurement)

    switch (measurement.type) {
      case InstrumentType.COUNTER:
      case InstrumentType.UP_DOWN_COUNTER:
        aggregateSum(metric, measurement, attrKey, stateKey, cumulativeState, true)
        break
      case InstrumentType.OBSERVABLE_COUNTER:
      case InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
        aggregateSum(metric, measurement, attrKey, stateKey, cumulativeState, false)
        break
      case InstrumentType.HISTOGRAM:
        aggregateHistogram(metric, measurement, attrKey, stateKey, cumulativeState)
        break
      default:
        aggregateLastValue(metric, measurement, attrKey)
    }
  }

  applyDeltaTemporality(metrics, lastExportedState)

  return metrics
}

module.exports = { aggregate, DEFAULT_HISTOGRAM_BUCKETS }
