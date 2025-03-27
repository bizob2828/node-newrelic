/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { SpanKind, propagation, trace, ROOT_CONTEXT } = require('@opentelemetry/api')

function doWorkInSpan({ tracer, spanName, spanKind }, cb) {
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

function addOTelAttribute({ agent, name, value }, cb) {
  const segment = agent.tracer.getSegment()
  segment.addAttribute(name, value)
  cb(segment)
}

function recordExceptionOnSpan({ errorMessage }, cb) {
  const active = trace.getActiveSpan()
  const errorEvent = {
    name: 'exception',
    attributes: {
      'exception.message': errorMessage
    }
  }
  active.status.code = 2
  active.addEvent('exception', errorEvent.attributes)
  cb(active)
}

function doWorkInSpanWithInboundContext({ tracer, spanKind, traceIdInHeader, spanIdInHeader, sampledFlagInHeader, spanName }, cb) {
  const headers = {
    traceparent: `00-${traceIdInHeader}-${spanIdInHeader}-0${sampledFlagInHeader}`
  }
  const ctx = propagation.extract(ROOT_CONTEXT, headers)
  const kind = SpanKind[spanKind.toUpperCase()]
  tracer.startActiveSpan(spanName, { kind }, ctx, cb)
}

module.exports = {
  addOTelAttribute,
  doWorkInSegment,
  doWorkInSpan,
  doWorkInSpanWithInboundContext,
  doWorkInTransaction,
  recordExceptionOnSpan
}
