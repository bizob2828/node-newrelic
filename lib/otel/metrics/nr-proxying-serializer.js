/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { NrMetricsSerializer } = require('./otlp/nr-metrics-serializer.js')
const defaultLogger = require('#agentlib/logger.js').child({
  component: 'nr-proxying-serializer'
})

/**
 * Wraps `NrMetricsSerializer` to add audit logging around serialization and
 * deserialization, keeping that cross-cutting concern out of the delegate
 * that actually performs the export. Used by `nr-exporter.js`.
 */
class NRProxyingSerializer {
  #destinationUrl
  #logger

  constructor({ destinationUrl = null, logger = defaultLogger } = {}) {
    this.#destinationUrl = destinationUrl
    this.#logger = logger.child({ subcomponent: this.constructor.name })
  }

  serializeRequest(metrics) {
    const serialized = NrMetricsSerializer.serializeRequest(metrics)
    if (this.#logger.auditEnabled() === true) {
      // We section this off because it is potentially expensive.
      // 1. We can't use `serialized.toBase64()` because that isn't avilable
      // untile Node.js >= 25.
      // 2. Using `new DataView(serialized)` to get the byte length would
      // still be necessary because `UInt8Array` doesn't have a byte length
      // field.
      // So it's a bit cheaper to use `Buffer`, but still expensive if we
      // don't need to log the information.
      const buffer = Buffer.from(serialized)
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

  deserializeResponse(data) {
    if (this.#logger.auditEnabled() === true) {
      this.#logger.audit(
        { data: Buffer.from(data).toString('base64') },
        'Received response data.'
      )
    }
    return NrMetricsSerializer.deserializeResponse(data)
  }
}

module.exports = NRProxyingSerializer
