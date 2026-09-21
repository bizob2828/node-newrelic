/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const defaultLogger = require('#agentlib/logger.js').child({
  component: 'nr-json-serializer'
})

/**
 * Converts an HrTime tuple `[seconds, nanoseconds]` to an epoch-nanoseconds
 * string, as required by the OTLP JSON format. BigInt is used because
 * nanosecond epoch values (~1.7e18) exceed Number.MAX_SAFE_INTEGER (~9e15).
 *
 * @param {number[]} hrTime `[seconds, nanoseconds]` HrTime tuple.
 * @returns {string} Epoch nanoseconds as a decimal string.
 */
function hrTimeToNanoString(hrTime) {
  return (BigInt(hrTime[0]) * 1_000_000_000n + BigInt(hrTime[1])).toString()
}

function encodeAttribute(key, value) {
  let v
  if (Array.isArray(value)) {
    v = { arrayValue: { values: value.map((item) => encodeAnyValue(item)) } }
  } else {
    v = encodeAnyValue(value)
  }
  return { key, value: v }
}

function encodeAnyValue(value) {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
  }
  return { stringValue: String(value) }
}

function encodeAttributes(attributes) {
  return Object.entries(attributes ?? {}).map(([k, v]) => encodeAttribute(k, v))
}

function encodeSumDataPoint(pt) {
  const dp = {
    attributes: encodeAttributes(pt.attributes),
    startTimeUnixNano: hrTimeToNanoString(pt.startTime),
    timeUnixNano: hrTimeToNanoString(pt.collectTime)
  }
  if (Number.isInteger(pt.value)) {
    dp.asInt = String(pt.value)
  } else {
    dp.asDouble = pt.value
  }
  return dp
}

function encodeGaugeDataPoint(pt) {
  const dp = {
    attributes: encodeAttributes(pt.attributes),
    timeUnixNano: hrTimeToNanoString(pt.collectTime)
  }
  if (Number.isInteger(pt.value)) {
    dp.asInt = String(pt.value)
  } else {
    dp.asDouble = pt.value
  }
  return dp
}

function encodeHistogramDataPoint(pt) {
  const dp = {
    attributes: encodeAttributes(pt.attributes),
    startTimeUnixNano: hrTimeToNanoString(pt.startTime),
    timeUnixNano: hrTimeToNanoString(pt.collectTime),
    count: String(pt.count),
    sum: pt.sum,
    bucketCounts: pt.bucketCounts.map((c) => String(c)),
    explicitBounds: pt.explicitBounds
  }
  if (pt.min !== undefined) dp.min = pt.min
  if (pt.max !== undefined) dp.max = pt.max
  return dp
}

function encodeMetric(metric) {
  if (metric.type === 'sum') {
    return {
      name: metric.name,
      description: metric.description,
      unit: metric.unit,
      sum: {
        dataPoints: metric.points.map(encodeSumDataPoint),
        aggregationTemporality: 1, // DELTA
        isMonotonic: metric.isMonotonic ?? true
      }
    }
  }

  if (metric.type === 'gauge') {
    return {
      name: metric.name,
      description: metric.description,
      unit: metric.unit,
      gauge: { dataPoints: metric.points.map(encodeGaugeDataPoint) }
    }
  }

  if (metric.type === 'histogram') {
    return {
      name: metric.name,
      description: metric.description,
      unit: metric.unit,
      histogram: {
        dataPoints: metric.points.map(encodeHistogramDataPoint),
        aggregationTemporality: 1 // DELTA
      }
    }
  }

  return null
}

/**
 * Serializes `NrResourceMetrics` to OTLP JSON and deserializes OTLP JSON
 * responses, writing audit logs for both operations when audit logging is
 * enabled.
 *
 * Mirrors the audit-logging responsibilities of the former
 * `NRProxyingSerializer` (which wrapped `ProtobufMetricsSerializer`).
 *
 * @see https://opentelemetry.io/docs/specs/otlp/#otlphttp
 */
class NrJsonSerializer {
  #destinationUrl
  #logger

  /**
   * @param {object} options Constructor options.
   * @param {string} [options.destinationUrl]  Logged in audit messages.
   * @param {object} [options.logger]          Agent logger instance.
   */
  constructor({ destinationUrl = '', logger = defaultLogger } = {}) {
    this.#destinationUrl = destinationUrl
    this.#logger = logger.child({ subcomponent: this.constructor.name })
  }

  /**
   * Serializes an `NrResourceMetrics` object to an OTLP JSON string.
   * Writes an audit log entry when audit logging is enabled.
   *
   * @param {object} nrResourceMetrics Metrics object produced by `NrMeterProvider`.
   * @returns {string} JSON string ready for `Content-Type: application/json`.
   */
  serializeRequest(nrResourceMetrics) {
    const { resource, scopeMetrics } = nrResourceMetrics

    const encodedScopeMetrics = (scopeMetrics ?? [])
      .map((sm) => {
        return {
          scope: { name: sm.scope?.name ?? '', version: sm.scope?.version ?? '' },
          metrics: sm.metrics.map(encodeMetric).filter(Boolean)
        }
      })
      .filter((sm) => sm.metrics.length > 0)

    const payload = {
      resourceMetrics: [{
        resource: { attributes: encodeAttributes(resource?.attributes ?? {}) },
        scopeMetrics: encodedScopeMetrics
      }]
    }

    const serialized = JSON.stringify(payload)

    if (this.#logger.auditEnabled?.() === true) {
      const buffer = Buffer.from(serialized, 'utf8')
      this.#logger.audit(
        {
          destUrl: this.#destinationUrl,
          data: buffer.toString('base64'),
          bytes: buffer.byteLength
        },
        'Serialized metrics data.'
      )
    }

    return serialized
  }

  /**
   * Deserializes an OTLP JSON response body received from the collector.
   * Writes an audit log entry when audit logging is enabled.
   *
   * @param {Buffer} data  Raw response body bytes.
   */
  deserializeResponse(data) {
    if (this.#logger.auditEnabled?.() === true) {
      this.#logger.audit(
        { data: Buffer.from(data).toString('base64') },
        'Received response data.'
      )
    }
  }
}

module.exports = NrJsonSerializer
