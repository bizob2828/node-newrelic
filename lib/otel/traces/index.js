/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const defaultLogger = require('../../logger').child({ component: 'opentelemetry-traces' })
const SetupSignal = require('../setup-signal.js')
const NrSampler = require('./sampler.js')
const NrSpanProcessor = require('./span-processor.js')
const NrTracerProvider = require('./nr-tracer-provider.js')

class SetupTraces extends SetupSignal {
  constructor({ agent, logger = defaultLogger } = {}) {
    super({ agent, logger })

    const sampler = new NrSampler()
    const processor = new NrSpanProcessor(agent)
    const traceProvider = new NrTracerProvider({ sampler, processor })
    this.coreApi.trace.setGlobalTracerProvider(traceProvider)

    agent.metrics
      .getOrCreateMetric('Supportability/Tracing/Nodejs/OpenTelemetryBridge/enabled')
      .incrementCallCount()
  }

  teardown() {
    this.coreApi.trace.disable()
  }
}

module.exports = SetupTraces
