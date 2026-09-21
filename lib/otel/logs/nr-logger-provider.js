/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const NrLogger = require('./nr-logger.js')

/**
 * Implements the `@opentelemetry/api-logs` `LoggerProvider` interface.
 * Returns `NrLogger` instances that route directly to the NR emit handler,
 * replacing the `@opentelemetry/sdk-logs` `LoggerProvider` +
 * `BatchLogRecordProcessor` + `NoOpExporter` stack.
 *
 * @see https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api-logs.LoggerProvider.html
 */
class NrLoggerProvider {
  #emitHandler

  constructor(emitHandler) {
    this.#emitHandler = emitHandler
  }

  getLogger(_name, _version, _options) {
    return new NrLogger(this.#emitHandler)
  }
}

module.exports = NrLoggerProvider
