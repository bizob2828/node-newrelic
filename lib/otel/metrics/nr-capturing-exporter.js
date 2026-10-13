/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const {
  ExportResultCode
} = require('../constants')
const { NrMetricsSerializer } = require('./otlp/nr-metrics-serializer.js')
const defaultLogger = require('#agentlib/logger.js').child({
  component: 'nr-capturing-exporter'
})

/**
 * Implements the exporter shape `sdk/periodic-metric-reader.js` expects
 * (`export`/`forceFlush`/`shutdown`). This exporter is the entrypoint to the
 * metrics collection/harvest process in serverless mode. By providing our
 * own implementation, we are able to serialize the data to a protobuf array
 * and collect it without incurring a network operation.
 */
class NRCapturingExporter {
  #logger

  /**
   * Used to cache the most recent serialization data as a Base64 encoded
   * string. We need a way to expose this data to the agent during harvest
   * time, so we simply cache it and allow the harvester to retrive it after
   * a successful exporter `.export` invocation.
   *
   * @type {string}
   */
  #lastSerialization = ''

  constructor({ logger = defaultLogger } = {}) {
    this.#logger = logger.child({ subcomponent: this.constructor.name })
  }

  /**
   * Retrieve the most recent serialization data and purge the cache.
   *
   * @returns {string} Base64 encoded string that decodes to a protobuf array.
   */
  get lastSerialization() {
    const result = this.#lastSerialization
    this.#lastSerialization = ''
    return result
  }

  export(metrics, callback) {
    const serialized = NrMetricsSerializer.serializeRequest(metrics)
    const buffer = Buffer.from(serialized)
    this.#lastSerialization = buffer.toString('base64')

    this.#logger.audit(
      {
        destUrl: 'local capture',
        data: this.#lastSerialization,
        bytes: buffer.byteLength
      },
      'Serialized metrics data.'
    )

    // eslint-disable-next-line n/no-callback-literal
    callback({ code: ExportResultCode.SUCCESS })
  }

  forceFlush() { return Promise.resolve() }

  shutdown() { return Promise.resolve() }
}

module.exports = NRCapturingExporter
