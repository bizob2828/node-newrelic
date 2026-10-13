/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { createContextKey } = require('@opentelemetry/api')
const ExportResultCode = { SUCCESS: 0, FAILED: 1 }
const SamplingDecision = {
  NOT_RECORD: 0,
  RECORD: 1,
  RECORD_AND_SAMPLED: 2
}
// Mirrors `@opentelemetry/sdk-metrics`' `AggregationTemporality` enum. Values
// are spec-mandated and compared by `@opentelemetry/sdk-metrics` internals
// as plain numbers, so a local copy is safe and avoids depending on that
// package's exported enum object just for these two values.
const AggregationTemporality = { DELTA: 0, CUMULATIVE: 1 }
// Mirrors `@opentelemetry/sdk-metrics`' `AggregationType` enum. Only
// `DEFAULT` is ever used by the metrics bridge.
const AggregationType = { DEFAULT: 0 }
// Mirrors `@opentelemetry/sdk-metrics`' `InstrumentType` enum. Each value
// equals its own key name, so these are the exact strings
// `@opentelemetry/sdk-metrics` passes to `selectAggregationTemporality`.
const InstrumentType = {
  COUNTER: 'COUNTER',
  GAUGE: 'GAUGE',
  HISTOGRAM: 'HISTOGRAM',
  UP_DOWN_COUNTER: 'UP_DOWN_COUNTER',
  OBSERVABLE_COUNTER: 'OBSERVABLE_COUNTER',
  OBSERVABLE_GAUGE: 'OBSERVABLE_GAUGE',
  OBSERVABLE_UP_DOWN_COUNTER: 'OBSERVABLE_UP_DOWN_COUNTER'
}
const SUPPRESS_TRACING_KEY = createContextKey('OpenTelemetry SDK Context Key SUPPRESS_TRACING')
const ATTR_VALUE_LENGTH_LIMIT = 4_095

module.exports = {
  AggregationTemporality,
  AggregationType,
  ATTR_VALUE_LENGTH_LIMIT,
  ExportResultCode,
  InstrumentType,
  SamplingDecision,
  SUPPRESS_TRACING_KEY
}
