/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { AggregationTemporality, InstrumentType } = require('../../constants.js')
const { stableStringify } = require('../stable-stringify.js')
const { getMetricsProtobufTypes } = require('./otlp-proto-loader.js')

/**
 * Maps a single attribute value to OTLP's `AnyValue` oneof shape. `null`/
 * `undefined` becomes an unset `AnyValue` (`{}`), matching real
 * `@opentelemetry/otlp-transformer`'s behavior -- safe here because
 * `sdk/sanitize-attributes.js` already guarantees nothing else reaches
 * this function (no plain objects, no mixed-type arrays).
 *
 * @param {*} value The attribute value to map.
 * @returns {object} The `AnyValue`-shaped object.
 */
function transformAnyValue(value) {
  if (value == null) {
    return {}
  }
  if (typeof value === 'string') {
    return { stringValue: value }
  }
  if (typeof value === 'boolean') {
    return { boolValue: value }
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: value } : { doubleValue: value }
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.filter((item) => item != null).map(transformAnyValue)
      }
    }
  }
  return {}
}

/**
 * Maps a plain attributes object to OTLP's `repeated KeyValue` shape.
 *
 * @param {object} [attributes] The attributes to map.
 * @returns {object[]} The `KeyValue[]`-shaped array.
 */
function transformAttributes(attributes = {}) {
  return Object.entries(attributes).map(([key, value]) => {
    return {
      key,
      value: transformAnyValue(value)
    }
  })
}

function temporalityToProto(temporality) {
  const { AggregationTemporality: ProtoTemporality } = getMetricsProtobufTypes()
  return temporality === AggregationTemporality.DELTA
    ? ProtoTemporality.AGGREGATION_TEMPORALITY_DELTA
    : ProtoTemporality.AGGREGATION_TEMPORALITY_CUMULATIVE
}

function transformNumberDataPoint(dataPoint) {
  const value = Number.isInteger(dataPoint.value)
    ? { asInt: dataPoint.value }
    : { asDouble: dataPoint.value }
  return {
    attributes: transformAttributes(dataPoint.attributes),
    startTimeUnixNano: dataPoint.startTimeUnixNano,
    timeUnixNano: dataPoint.timeUnixNano,
    ...value
  }
}

function transformHistogramDataPoint(dataPoint) {
  const result = {
    attributes: transformAttributes(dataPoint.attributes),
    startTimeUnixNano: dataPoint.startTimeUnixNano,
    timeUnixNano: dataPoint.timeUnixNano,
    count: dataPoint.count,
    sum: dataPoint.sum,
    bucketCounts: dataPoint.bucketCounts,
    explicitBounds: dataPoint.explicitBounds
  }
  // Delta histogram data points omit min/max entirely (see metric-aggregator.js).
  if (dataPoint.min !== undefined) result.min = dataPoint.min
  if (dataPoint.max !== undefined) result.max = dataPoint.max
  return result
}

function transformMetric(metric) {
  const base = { name: metric.name, description: metric.description, unit: metric.unit }
  const dataPoints = [...metric.dataPoints.values()]

  switch (metric.type) {
    case InstrumentType.HISTOGRAM:
      return {
        ...base,
        histogram: {
          dataPoints: dataPoints.map(transformHistogramDataPoint),
          aggregationTemporality: temporalityToProto(metric.temporality)
        }
      }
    case InstrumentType.COUNTER:
    case InstrumentType.OBSERVABLE_COUNTER:
    case InstrumentType.UP_DOWN_COUNTER:
    case InstrumentType.OBSERVABLE_UP_DOWN_COUNTER:
      return {
        ...base,
        sum: {
          dataPoints: dataPoints.map(transformNumberDataPoint),
          aggregationTemporality: temporalityToProto(metric.temporality),
          isMonotonic: metric.isMonotonic
        }
      }
    default:
      // GAUGE / OBSERVABLE_GAUGE -- OTLP's `Gauge` message has no
      // aggregation_temporality field at all.
      return {
        ...base,
        gauge: {
          dataPoints: dataPoints.map(transformNumberDataPoint)
        }
      }
  }
}

function transformScope(scope) {
  const result = { name: scope.name, version: scope.version }
  if (scope.attributes && Object.keys(scope.attributes).length > 0) {
    result.attributes = transformAttributes(scope.attributes)
  }
  return result
}

/**
 * Groups aggregated metrics by instrumentation scope, since OTLP's wire
 * format nests metrics under `ScopeMetrics` rather than carrying the scope
 * on each individual metric.
 *
 * @param {Map} metrics Aggregated metrics, as produced by `metric-aggregator.js`.
 * @returns {object[]} `[{ scope, metrics: [...] }]`.
 */
function groupByInstrumentationScope(metrics) {
  const groups = new Map()
  for (const metric of metrics.values()) {
    const scope = metric.instrumentationScope
    const key = `${scope.name}@${scope.version}@${scope.schemaUrl}@${stableStringify(scope.attributes ?? {})}`
    let group = groups.get(key)
    if (!group) {
      group = { scope, metrics: [] }
      groups.set(key, group)
    }
    group.metrics.push(metric)
  }
  return [...groups.values()]
}

/**
 * Maps this bridge's internal `{ resource, metrics }` shape (as produced by
 * `sdk/periodic-metric-reader.js`) into a plain JS object matching OTLP's
 * `ResourceMetrics` message, ready to hand to `protobufjs`'s `.create()`.
 *
 * @param {object} resourceMetrics `{ resource, metrics }`.
 * @param {object} resourceMetrics.resource The resource to attach.
 * @param {Map} resourceMetrics.metrics Aggregated metrics to include.
 * @returns {object} The `ResourceMetrics`-shaped object.
 */
function transformResourceMetrics({ resource, metrics }) {
  const scopeGroups = groupByInstrumentationScope(metrics)
  return {
    resource: {
      attributes: transformAttributes(resource.attributes),
      droppedAttributesCount: 0
    },
    scopeMetrics: scopeGroups.map((group) => {
      return {
        scope: transformScope(group.scope),
        schemaUrl: group.scope.schemaUrl || undefined,
        metrics: group.metrics.map(transformMetric)
      }
    })
  }
}

module.exports = { transformResourceMetrics, transformAttributes, transformAnyValue }
