/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const otel = require('@opentelemetry/api')

function currentOTelSpan() {
  const active = otel.trace.getActiveSpan()

  if (!active || active?.constructor?.name === 'NonRecordingSpan') {
    return null
  }

  return active?.spanContext()
}

function currentTransaction(agent) {
  return agent.getTransaction()
}

function currentSegment(agent) {
  const segment = agent.tracer.getSegment()
  return {
    spanId: segment?.id
  }
}

module.exports = {
  currentOTelSpan,
  currentSegment,
  currentTransaction
}
