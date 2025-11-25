/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const AdaptiveSampler = require('./adaptive-sampler')
const AlwaysOffSampler = require('./always-off-sampler')
const AlwaysOnSampler = require('./always-on-sampler')
const TraceIdRatioBasedSampler = require('./ratio-based-sampler')

class Samplers {
  constructor(agent) {
    const config = agent.config
    this.adaptiveSampler = null
    this.root = this.determineSampler({ agent, config, sampler: 'root' })
    this.remoteParentSampled = this.determineSampler({ agent, config, sampler: 'remote_parent_sampled' })
    this.remoteParentNotSampled = this.determineSampler({ agent, config, sampler: 'remote_parent_not_sampled' })
  }

  applySamplingDecision({ type = 'root', transaction }) {
    if (transaction?.priority === null) {
      this[type].applySamplingDecision({ transaction })
    }
  }

  applyDTSamplingDecision({ transaction, traceparent, tracestate }) {
    // Decide sampling from w3c data by supplying tracestate to sampler
    if (traceparent?.isSampled === true) {
      this.remoteParentSampled.applySamplingDecision({ transaction, tracestate })
    } else if (traceparent?.isSampled === false) {
      this.remoteParentNotSampled.applySamplingDecision({ transaction, tracestate })
    }
  }

  /**
   * Even though New Relic headers are deprecated,
   * we still have to apply our sampling decision on top
   * of the priority and sampled values we receive.
   * However, this only applies if the sampler is NOT
   * the default sampler (adaptive). In that case,
   * we leave it alone. ¯\_(ツ)_/¯
   *
   * @param {object} param to function
   * @param {Transaction} param.transaction The transaction to apply the sampling decision to.
   * @param {boolean} param.isSampled The sampled value from the legacy New Relic headers.
   */
  applyLegacyDTSamplingDecision({ transaction, isSampled }) {
    const sampler = isSampled ? this.remoteParentSampled : this.remoteParentNotSampled
    if (sampler.toString() !== 'AdaptiveSampler') {
      sampler.applySamplingDecision({ transaction })
    }
  }

  updateAdaptiveTarget(target) {
    if (this.adaptiveSampler) {
      this.adaptiveSampler.samplingTarget = target
    }
  }

  updateAdaptivePeriod(period) {
    if (this.adaptiveSampler) {
      this.adaptiveSampler.samplingPeriod = period * 1000
    }
  }

  getAdaptiveSampler({ agent, config }) {
    if (!this.adaptiveSampler) {
      this.adaptiveSampler = new AdaptiveSampler({
        agent,
        serverless: config.serverless_mode.enabled,
        period: config.sampling_target_period_in_seconds * 1000,
        target: config.sampling_target
      })
    }
    return this.adaptiveSampler
  }

  /**
   * Determines which sampler to use and will log messages about the chosen sampler.
   * @param {*} params Function parameters.
   * @param {Agent} params.agent The New Relic agent instance.
   * @param {object} params.config The entire agent config.
   * @param {string} params.sampler The sampler type to use: 'root', 'remote_parent_sampled', or 'remote_parent_not_sampled'.
   * @returns {Sampler} A Sampler e.g. AdaptiveSampler
   */
  determineSampler({ agent, config, sampler }) {
    // TODO: handle partial granularity samplers
    const samplerDefinition = config?.distributed_tracing?.sampler?.[sampler]

    // Always on?
    if (samplerDefinition === 'always_on') {
      return new AlwaysOnSampler()
    }

    // Always off?
    if (samplerDefinition === 'always_off') {
      return new AlwaysOffSampler()
    }

    // Is it TraceIdRatioBased?
    if (samplerDefinition?.trace_id_ratio_based) {
      return new TraceIdRatioBasedSampler({
        agent,
        ratio: samplerDefinition.trace_id_ratio_based?.ratio
      })
    }

    // If adaptive.sampling_target set, create a new AdaptiveSampler,
    // else use the global AdaptiveSampler.
    if (samplerDefinition?.adaptive?.sampling_target) {
      return new AdaptiveSampler({
        agent,
        serverless: config.serverless_mode.enabled,
        period: config.sampling_target_period_in_seconds * 1000,
        target: samplerDefinition.adaptive.sampling_target
      })
    } else {
      return this.getAdaptiveSampler({ agent, config })
    }
  }
}

module.exports = Samplers
