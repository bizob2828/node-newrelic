/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { createContextKey } = require('@opentelemetry/api')

const ExportResultCode = { SUCCESS: 0, FAILED: 1 }

const AggregationTemporality = { DELTA: 0, CUMULATIVE: 1 }

const AggregationType = {
  DEFAULT: 0,
  DROP: 1,
  SUM: 2,
  LAST_VALUE: 3,
  EXPLICIT_BUCKET_HISTOGRAM: 4,
  EXPONENTIAL_HISTOGRAM: 5
}

const SUPPRESS_TRACING_KEY = createContextKey('OpenTelemetry SDK Context Key SUPPRESS_TRACING')

const ATTR_VALUE_LENGTH_LIMIT = 4_095

module.exports = {
  ATTR_VALUE_LENGTH_LIMIT,
  AggregationTemporality,
  AggregationType,
  ExportResultCode,
  SUPPRESS_TRACING_KEY
}
