/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { SpanKind } = require('@opentelemetry/api')

function doWorkInSpan({ agent, tracer, spanName, spanKind }, cb) {
  const kind = SpanKind[spanKind.toUpperCase()]
  tracer.startActiveSpan(spanName, { kind }, cb)
}

function doWorkInTransaction({ api, agent, transactionName }, cb) {
  api.startBackgroundTransaction(transactionName, () => {
    const transaction = agent.tracer.getTransaction()
    // need to end the tx after doing a bunch of child operations
    transaction.handledExternally = true
    cb(transaction)
  })
}

function doWorkInSegment({ agent, api, segmentName }, cb) {
  api.startSegment(segmentName, true, () => {
    const segment = agent.tracer.getSegment()
    cb(segment)
  })
}

module.exports = {
  doWorkInSegment,
  doWorkInSpan,
  doWorkInTransaction
}
