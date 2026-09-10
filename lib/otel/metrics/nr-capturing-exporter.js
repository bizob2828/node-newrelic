/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { AggregationTemporality, ExportResultCode } = require('../constants.js')
const NrJsonSerializer = require('./nr-json-serializer.js')
const defaultLogger = require('#agentlib/logger.js').child({
  component: 'nr-capturing-exporter'
})

/**
 * Implements the required bits of the `PushMetricExporter` interface. Such an
 * exporter is the entrypoint to the metrics collection/harvest process. By
 * providing our own implementation, we are able to serialize the data to
 * a protobuf array and collect it without incurring a network operation.
 *
 * @see https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_sdk-metrics.PushMetricExporter.html
 */
class NRCapturingExporter {
  #serializer
  #lastSerialization = ''

  constructor({ logger = defaultLogger } = {}) {
    const childLogger = logger.child({ subcomponent: this.constructor.name })
    this.#serializer = new NrJsonSerializer({
      destinationUrl: 'local capture',
      logger: childLogger
    })
  }

  /**
   * Retrieve the most recent serialization data and purge the cache.
   *
   * @returns {string} Base64 encoded string that decodes to an OTLP JSON payload.
   */
  get lastSerialization() {
    const result = this.#lastSerialization
    this.#lastSerialization = ''
    return result
  }

  export(metrics, callback) {
    const serialized = this.#serializer.serializeRequest(metrics)
    const buffer = Buffer.from(serialized, 'utf8')
    this.#lastSerialization = buffer.toString('base64')
    callback({ code: ExportResultCode.SUCCESS })
  }

  selectAggregationTemporality() { return AggregationTemporality.DELTA }

  forceFlush() { return Promise.resolve() }

  shutdown() { return Promise.resolve() }
}

module.exports = NRCapturingExporter
