/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { getMetricsProtobufTypes } = require('./otlp-proto-loader.js')
const { transformResourceMetrics } = require('./metrics-transformer.js')

/**
 * Minimal drop-in replacement for `@opentelemetry/otlp-transformer`'s
 * `ProtobufMetricsSerializer`, exposing exactly the two methods this
 * bridge's exporters call. The actual varint/tag/length-delimited wire
 * encoding is done by `protobufjs`, driven by the vendored OTLP proto
 * schema in `./proto/` -- only the JS-object-to-OTLP-shape mapping
 * (`metrics-transformer.js`) is hand-written.
 */
const NrMetricsSerializer = {
  /**
   * @param {object} resourceMetrics `{ resource, metrics }`, as produced by
   * `sdk/periodic-metric-reader.js`.
   * @returns {Uint8Array} The encoded `ExportMetricsServiceRequest` bytes.
   */
  serializeRequest(resourceMetrics) {
    const { ExportMetricsServiceRequest } = getMetricsProtobufTypes()
    const payload = { resourceMetrics: [transformResourceMetrics(resourceMetrics)] }
    return ExportMetricsServiceRequest.encode(ExportMetricsServiceRequest.create(payload)).finish()
  },

  /**
   * @param {Buffer|Uint8Array} data The raw `ExportMetricsServiceResponse` bytes.
   * @returns {object} The decoded response.
   */
  deserializeResponse(data) {
    const { ExportMetricsServiceResponse } = getMetricsProtobufTypes()
    return ExportMetricsServiceResponse.decode(data)
  }
}

module.exports = { NrMetricsSerializer }
