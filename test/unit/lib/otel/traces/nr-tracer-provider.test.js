/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const NrTracerProvider = require('#agentlib/otel/traces/nr-tracer-provider.js')
const NrTracer = require('#agentlib/otel/traces/nr-tracer.js')
const { SamplingDecision } = require('@opentelemetry/api')

function makeSampler(decision = SamplingDecision.RECORD_AND_SAMPLED) {
  return { shouldSample: () => { return { decision } } }
}

function makeProcessor() {
  return { onStart() {}, onEnd() {} }
}

test('getTracer returns an NrTracer', () => {
  const provider = new NrTracerProvider({ sampler: makeSampler(), processor: makeProcessor() })
  const tracer = provider.getTracer('test-lib', '1.0')
  assert.ok(tracer instanceof NrTracer)
})

test('getTracer passes instrumentation scope to the tracer', (t) => {
  const processor = {
    onStart(span) { t.assert.equal(span.instrumentationScope.name, 'my-lib') },
    onEnd() {}
  }
  const provider = new NrTracerProvider({ sampler: makeSampler(), processor })
  const tracer = provider.getTracer('my-lib', '2.0')
  tracer.startSpan('op')
})

test('forceFlush resolves', async () => {
  const provider = new NrTracerProvider({ sampler: makeSampler(), processor: makeProcessor() })
  await assert.doesNotReject(() => provider.forceFlush())
})

test('shutdown resolves', async () => {
  const provider = new NrTracerProvider({ sampler: makeSampler(), processor: makeProcessor() })
  await assert.doesNotReject(() => provider.shutdown())
})
