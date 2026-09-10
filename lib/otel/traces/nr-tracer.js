/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const crypto = require('node:crypto')
const { context, trace, TraceFlags } = require('@opentelemetry/api')
const { SamplingDecision } = require('../constants.js')
const { NrSpan, toHrTime } = require('./nr-span.js')

function generateTraceId() {
  return crypto.randomBytes(16).toString('hex')
}

function generateSpanId() {
  return crypto.randomBytes(8).toString('hex')
}

/**
 * Implements the `@opentelemetry/api` `Tracer` interface using `NrSpan` for
 * span creation. Wires the sampler and processor from the owning
 * `NrTracerProvider`.
 *
 * @see https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api._opentelemetry_api.Tracer.html
 */
class NrTracer {
  #instrumentationScope
  #sampler
  #processor

  constructor({ instrumentationScope, sampler, processor }) {
    this.#instrumentationScope = instrumentationScope
    this.#sampler = sampler
    this.#processor = processor
  }

  startSpan(name, options = {}, ctx) {
    const activeCtx = ctx ?? context.active()
    const parentSpanContext = trace.getSpanContext(activeCtx)
    const spanKind = options.kind ?? 0 // SpanKind.INTERNAL
    const traceId = parentSpanContext?.traceId ?? generateTraceId()
    const spanId = generateSpanId()

    const samplingResult = this.#sampler.shouldSample(
      activeCtx,
      traceId,
      name,
      spanKind,
      options.attributes ?? {},
      options.links ?? []
    )

    if (samplingResult.decision === SamplingDecision.NOT_RECORD) {
      return trace.wrapSpanContext({
        traceId,
        spanId,
        traceFlags: TraceFlags.NONE,
        isRemote: false
      })
    }

    const spanContext = {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
      traceState: parentSpanContext?.traceState
    }

    const span = new NrSpan({
      name,
      kind: spanKind,
      spanContext,
      parentSpanId: parentSpanContext?.spanId,
      startTime: options.startTime ? toHrTime(options.startTime) : undefined,
      attributes: options.attributes,
      links: options.links,
      instrumentationScope: this.#instrumentationScope,
      processor: this.#processor
    })

    this.#processor?.onStart(span, activeCtx)
    return span
  }

  startActiveSpan(name, optionsOrFn, contextOrFn, fn) {
    // Normalize the three-way overload:
    //   startActiveSpan(name, fn)
    //   startActiveSpan(name, options, fn)
    //   startActiveSpan(name, options, context, fn)
    let opts = {}
    let ctx = context.active()

    if (typeof optionsOrFn === 'function') {
      fn = optionsOrFn
    } else if (typeof contextOrFn === 'function') {
      opts = optionsOrFn
      fn = contextOrFn
    } else {
      opts = optionsOrFn ?? {}
      ctx = contextOrFn ?? context.active()
      // fn is already the last argument
    }

    const span = this.startSpan(name, opts, ctx)
    const spanCtx = trace.setSpan(ctx, span)
    return context.with(spanCtx, fn, undefined, span)
  }
}

module.exports = NrTracer
