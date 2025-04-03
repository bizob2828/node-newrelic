/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { SpanKind, context, propagation, trace, ROOT_CONTEXT } = require('@opentelemetry/api')

function doWorkInSpan({ tracer, spanName, spanKind }, cb) {
  const kind = SpanKind[spanKind.toUpperCase()]
  if (kind === SpanKind.CLIENT) {
    const ctx = context.active()
    const span = tracer.startSpan(spanName, { kind }, ctx)
    cb(span)
    return
  }

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
  cb()
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
  cb()
}

function doWorkInSpanWithInboundContext({ tracer, spanKind, traceIdInHeader, spanIdInHeader, sampledFlagInHeader, spanName }, cb) {
  const headers = {
    traceparent: `00-${traceIdInHeader}-${spanIdInHeader}-0${sampledFlagInHeader}`
  }
  const ctx = propagation.extract(ROOT_CONTEXT, headers)
  const kind = SpanKind[spanKind.toUpperCase()]
  tracer.startActiveSpan(spanName, { kind }, ctx, cb)
}

function simulateExternalCall({ agent, url, data }, cb) {
  if (data?.constructor?.name === 'SpanImpl') {
    const span = data
    const parentContext = context.active()
    span.setAttribute('http.request.method', 'GET')
    span.setAttribute('server.adresss', 'newrelic.com')
    span.setAttribute('url.full', `https://newrelic.com/${url}`)
    const requestContext = trace.setSpan(parentContext, span)
    debugger
    cb(requestContext)
  } else {
    debugger
    data.addAttribute('url', url)
    agent.tracer.setSegment({ segment: data })
    const active = context.active()
    cb(active)
  }
}

function oTelInjectHeaders({ agent, data }, cb) {
  debugger
  const headers = {}
  // TODO: the doWorkInSegment path is not returning proper propagator
  propagation.inject(data, headers)
  agent.headers = headers

  return context.with(data, cb)
}

function nRInjectHeaders({ agent }, cb) {
  const ctx = agent.tracer.getTransaction()
  const headers = {}
  ctx.transaction.insertDistributedTraceHeaders(headers)
  agent.headers = headers
}

module.exports = {
  addOTelAttribute,
  doWorkInSegment,
  doWorkInSpan,
  doWorkInSpanWithInboundContext,
  doWorkInTransaction,
  nRInjectHeaders,
  recordExceptionOnSpan,
  simulateExternalCall,
  oTelInjectHeaders
}
