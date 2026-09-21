/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { ROOT_CONTEXT, SpanKind, context, trace, SamplingDecision } = require('@opentelemetry/api')
const NrTracer = require('#agentlib/otel/traces/nr-tracer.js')
const NrSpan = require('#agentlib/otel/traces/nr-span.js').NrSpan

function makeProcessor() {
  const calls = { onStart: [], onEnd: [] }
  return {
    calls,
    onStart(span, ctx) { calls.onStart.push({ span, ctx }) },
    onEnd(span) { calls.onEnd.push(span) }
  }
}

function makeSampler(decision = SamplingDecision.RECORD_AND_SAMPLED) {
  return { shouldSample: () => { return { decision } } }
}

function makeTracer(opts = {}) {
  return new NrTracer({
    instrumentationScope: { name: 'test', version: '1.0' },
    sampler: opts.sampler ?? makeSampler(),
    processor: opts.processor ?? makeProcessor()
  })
}

test('startSpan returns an NrSpan when sampled', () => {
  const tracer = makeTracer()
  const span = tracer.startSpan('op', {}, ROOT_CONTEXT)
  assert.ok(span instanceof NrSpan)
})

test('startSpan returns a non-recording span when NOT_RECORD', () => {
  const tracer = makeTracer({ sampler: makeSampler(SamplingDecision.NOT_RECORD) })
  const span = tracer.startSpan('op', {}, ROOT_CONTEXT)
  assert.ok(!(span instanceof NrSpan))
  assert.equal(span.isRecording(), false)
})

test('startSpan calls processor.onStart', () => {
  const processor = makeProcessor()
  const tracer = makeTracer({ processor })
  tracer.startSpan('op', {}, ROOT_CONTEXT)
  assert.equal(processor.calls.onStart.length, 1)
  assert.ok(processor.calls.onStart[0].span instanceof NrSpan)
})

test('startSpan generates a traceId when there is no parent context', () => {
  const tracer = makeTracer()
  const span = tracer.startSpan('op', {}, ROOT_CONTEXT)
  const { traceId } = span.spanContext()
  assert.match(traceId, /^[0-9a-f]{32}$/)
})

test('startSpan inherits traceId from parent span context', () => {
  const processor = makeProcessor()
  const tracer = makeTracer({ processor })
  const parent = tracer.startSpan('parent', {}, ROOT_CONTEXT)
  const parentCtx = trace.setSpan(ROOT_CONTEXT, parent)
  const child = tracer.startSpan('child', {}, parentCtx)
  assert.equal(child.spanContext().traceId, parent.spanContext().traceId)
})

test('startSpan sets parentSpanId from parent span context', () => {
  const tracer = makeTracer()
  const parent = tracer.startSpan('parent', {}, ROOT_CONTEXT)
  const parentCtx = trace.setSpan(ROOT_CONTEXT, parent)
  const child = tracer.startSpan('child', {}, parentCtx)
  assert.equal(child.parentSpanId, parent.spanContext().spanId)
})

test('startSpan sets span kind from options', () => {
  const tracer = makeTracer()
  const span = tracer.startSpan('op', { kind: SpanKind.SERVER }, ROOT_CONTEXT)
  assert.equal(span.kind, SpanKind.SERVER)
})

test('startSpan defaults to INTERNAL span kind', () => {
  const tracer = makeTracer()
  const span = tracer.startSpan('op', {}, ROOT_CONTEXT)
  assert.equal(span.kind, SpanKind.INTERNAL)
})

test('startSpan attaches instrumentation scope', () => {
  const tracer = makeTracer()
  const span = tracer.startSpan('op', {}, ROOT_CONTEXT)
  assert.equal(span.instrumentationScope.name, 'test')
  assert.equal(span.instrumentationScope.version, '1.0')
})

test('startActiveSpan(name, fn) calls fn with the span', (t, end) => {
  const tracer = makeTracer()
  tracer.startActiveSpan('op', (span) => {
    t.assert.ok(span instanceof NrSpan)
    end()
  })
})

test('startActiveSpan(name, opts, fn) passes options to startSpan', (t, end) => {
  const tracer = makeTracer()
  tracer.startActiveSpan('op', { kind: SpanKind.CLIENT }, (span) => {
    t.assert.equal(span.kind, SpanKind.CLIENT)
    end()
  })
})

test('startActiveSpan(name, opts, ctx, fn) uses the provided context', (t, end) => {
  const tracer = makeTracer()
  const parent = tracer.startSpan('parent', {}, ROOT_CONTEXT)
  const parentCtx = trace.setSpan(ROOT_CONTEXT, parent)
  tracer.startActiveSpan('child', {}, parentCtx, (span) => {
    t.assert.equal(span.parentSpanId, parent.spanContext().spanId)
    end()
  })
})

test('startActiveSpan calls context.with so the span is in scope during fn', (t, end) => {
  // Unit tests run with NoopContextManager so context.active() won't reflect
  // changes — verify that context.with is called with a context that contains
  // the new span, without relying on context.active() propagating correctly.
  const tracer = makeTracer()
  let ctxPassedToWith
  const origWith = context.with.bind(context)
  context.with = function spyWith(ctx, fn, thisArg, ...args) {
    ctxPassedToWith = ctx
    return origWith(ctx, fn, thisArg, ...args)
  }
  tracer.startActiveSpan('op', (span) => {
    t.assert.strictEqual(trace.getSpan(ctxPassedToWith), span)
    context.with = origWith
    end()
  })
})
