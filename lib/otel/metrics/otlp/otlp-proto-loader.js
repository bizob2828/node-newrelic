/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const path = require('node:path')
const protobuf = require('protobufjs')

const PROTO_DIR = path.join(__dirname, 'proto')

let types = null

/**
 * Loads (once, cached for the life of the process) the vendored OTLP
 * metrics proto definitions and resolves the message/enum types the
 * metrics bridge needs.
 *
 * @returns {object} `{ ExportMetricsServiceRequest, ExportMetricsServiceResponse, AggregationTemporality }`.
 */
function getMetricsProtobufTypes() {
  if (types) {
    return types
  }

  // protobufjs' default `resolvePath` resolves each `import` statement
  // relative to the importing file's own directory, not a fixed root --
  // which breaks these vendored files' `import "opentelemetry/proto/...'`
  // statements (written relative to a common proto include root). Override
  // it to always resolve against `PROTO_DIR` instead.
  const root = new protobuf.Root()
  root.resolvePath = (_origin, target) => path.join(PROTO_DIR, target)
  root.loadSync('opentelemetry/proto/collector/metrics/v1/metrics_service.proto')

  types = {
    ExportMetricsServiceRequest: root.lookupType(
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest'
    ),
    ExportMetricsServiceResponse: root.lookupType(
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse'
    ),
    AggregationTemporality: root.lookupEnum(
      'opentelemetry.proto.metrics.v1.AggregationTemporality'
    ).values
  }

  return types
}

module.exports = { getMetricsProtobufTypes, PROTO_DIR }
