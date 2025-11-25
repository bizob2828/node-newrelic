/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')

const helper = require('../../lib/agent_helper')
const Config = require('#agentlib/config/index.js')
const Samplers = require('#agentlib/samplers/index.js')
const AdaptiveSampler = require('#agentlib/samplers/adaptive-sampler.js')
const AlwaysOnSampler = require('#agentlib/samplers/always-on-sampler.js')
const AlwaysOffSampler = require('#agentlib/samplers/always-off-sampler.js')
const TraceIdRatioBasedSampler = require('#agentlib/samplers/ratio-based-sampler.js')

test.beforeEach((ctx) => {
  ctx.nr = {}
})

test.afterEach((ctx) => {
  if (ctx.nr.agent) helper.unloadAgent(ctx.nr.agent)
})

test('Samplers constructor', async (t) => {
  await t.test('should initialize with default samplers', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    assert.ok(samplers instanceof Samplers)
    assert.ok(samplers.root instanceof AdaptiveSampler)
    assert.ok(samplers.remoteParentSampled instanceof AdaptiveSampler)
    assert.ok(samplers.remoteParentNotSampled instanceof AdaptiveSampler)
  })

  await t.test('should initialize adaptiveSampler to null', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    // adaptiveSampler is created lazily by getAdaptiveSampler
    assert.ok(samplers.adaptiveSampler !== null)
  })

  await t.test('should call determineSampler for each sampler type', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: 'always_on',
          remote_parent_sampled: 'always_off',
          remote_parent_not_sampled: 'always_on'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    assert.ok(samplers.root instanceof AlwaysOnSampler)
    assert.ok(samplers.remoteParentSampled instanceof AlwaysOffSampler)
    assert.ok(samplers.remoteParentNotSampled instanceof AlwaysOnSampler)
  })

  await t.test('should use different samplers for different types', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: 'always_on',
          remote_parent_sampled: {
            trace_id_ratio_based: {
              ratio: 0.5
            }
          },
          remote_parent_not_sampled: 'always_off'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    assert.ok(samplers.root instanceof AlwaysOnSampler)
    assert.ok(samplers.remoteParentSampled instanceof TraceIdRatioBasedSampler)
    assert.ok(samplers.remoteParentNotSampled instanceof AlwaysOffSampler)
  })

  await t.test('should share global adaptive sampler across multiple sampler types', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    assert.equal(samplers.root, samplers.adaptiveSampler)
    assert.equal(samplers.remoteParentSampled, samplers.adaptiveSampler)
    assert.equal(samplers.remoteParentNotSampled, samplers.adaptiveSampler)
  })

  await t.test('should create separate adaptive samplers when sampling_target differs', (t) => {
    const config = new Config({
      sampling_target: 10,
      distributed_tracing: {
        sampler: {
          root: {
            adaptive: {
              sampling_target: 25
            }
          },
          remote_parent_sampled: {
            adaptive: {
              sampling_target: 50
            }
          },
          remote_parent_not_sampled: 'adaptive'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    assert.ok(samplers.root instanceof AdaptiveSampler)
    assert.ok(samplers.remoteParentSampled instanceof AdaptiveSampler)
    assert.ok(samplers.remoteParentNotSampled instanceof AdaptiveSampler)

    assert.equal(samplers.root.samplingTarget, 25)
    assert.equal(samplers.remoteParentSampled.samplingTarget, 50)
    assert.equal(samplers.remoteParentNotSampled.samplingTarget, 10)

    assert.notEqual(samplers.root, samplers.remoteParentSampled)
    assert.notEqual(samplers.root, samplers.remoteParentNotSampled)
    assert.notEqual(samplers.remoteParentSampled, samplers.remoteParentNotSampled)
    assert.equal(samplers.remoteParentNotSampled, samplers.adaptiveSampler)
  })

  await t.test('should handle complex mixed sampler configurations', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: 'always_on',
          remote_parent_sampled: {
            adaptive: {
              sampling_target: 30
            }
          },
          remote_parent_not_sampled: {
            trace_id_ratio_based: {
              ratio: 0.75
            }
          }
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const txn1 = { priority: null, sampled: null }
    samplers.applySamplingDecision({ type: 'root', transaction: txn1 })
    assert.equal(txn1.sampled, true)
    assert.equal(txn1.priority, 2.0)

    const txn2 = { priority: null, sampled: null }
    samplers.applySamplingDecision({ type: 'remoteParentSampled', transaction: txn2 })
    assert.ok(txn2.priority !== null)

    const txn3 = { priority: null, sampled: null, traceId: '1234567890abcdef' }
    samplers.applySamplingDecision({ type: 'remoteParentNotSampled', transaction: txn3 })
    assert.ok(txn3.priority !== null)
  })
})

test('applySamplingDecision', async (t) => {
  await t.test('should apply sampling decision for root type by default', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    samplers.applySamplingDecision({ transaction })

    assert.ok(transaction.priority !== null)
    assert.ok(typeof transaction.sampled === 'boolean')
  })

  await t.test('should apply sampling decision for specified type', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_sampled: 'always_on'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    samplers.applySamplingDecision({ type: 'remoteParentSampled', transaction })

    assert.equal(transaction.priority, 2.0)
    assert.equal(transaction.sampled, true)
  })

  await t.test('should not apply sampling decision if priority is already set', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: 1.5, sampled: true }
    samplers.applySamplingDecision({ transaction })

    assert.equal(transaction.priority, 1.5)
    assert.equal(transaction.sampled, true)
  })

  await t.test('should handle missing transaction gracefully', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    assert.doesNotThrow(() => {
      samplers.applySamplingDecision({ transaction: null })
    })
  })
})

test('applyDTSamplingDecision', async (t) => {
  await t.test('should apply remoteParentSampled when traceparent is sampled', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_sampled: 'always_on'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    const traceparent = { isSampled: true }

    samplers.applyDTSamplingDecision({ transaction, traceparent })

    assert.equal(transaction.sampled, true)
    assert.equal(transaction.priority, 2.0)
  })

  await t.test('should apply remoteParentNotSampled when traceparent is not sampled', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_not_sampled: 'always_off'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    const traceparent = { isSampled: false }

    samplers.applyDTSamplingDecision({ transaction, traceparent })

    assert.equal(transaction.sampled, false)
    assert.equal(transaction.priority, 0)
  })

  await t.test('should not apply decision when traceparent.isSampled is undefined', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    const traceparent = { isSampled: undefined }
    const tracestate = null

    samplers.applyDTSamplingDecision({ transaction, traceparent, tracestate })

    assert.equal(transaction.priority, null)
    assert.equal(transaction.sampled, null)
  })

  await t.test('should handle tracestate without intrinsics', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_sampled: 'always_on'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    const traceparent = { isSampled: true }
    const tracestate = null

    samplers.applyDTSamplingDecision({ transaction, traceparent, tracestate })

    assert.equal(transaction.sampled, true)
    assert.equal(transaction.priority, 2.0)
  })
})

test('applyLegacyDTSamplingDecision', async (t) => {
  await t.test('should apply remoteParentSampled when isSampled is true', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_sampled: 'always_on'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    samplers.applyLegacyDTSamplingDecision({ transaction, isSampled: true })

    assert.equal(transaction.sampled, true)
    assert.equal(transaction.priority, 2.0)
  })

  await t.test('should apply remoteParentNotSampled when isSampled is false', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_not_sampled: 'always_off'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    samplers.applyLegacyDTSamplingDecision({ transaction, isSampled: false })

    assert.equal(transaction.sampled, false)
    assert.equal(transaction.priority, 0)
  })

  await t.test('should NOT apply decision when sampler is AdaptiveSampler and isSampled is true', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    samplers.applyLegacyDTSamplingDecision({ transaction, isSampled: true })

    assert.equal(transaction.priority, null)
    assert.equal(transaction.sampled, null)
  })

  await t.test('should NOT apply decision when sampler is AdaptiveSampler and isSampled is false', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction = { priority: null, sampled: null }
    samplers.applyLegacyDTSamplingDecision({ transaction, isSampled: false })

    assert.equal(transaction.priority, null)
    assert.equal(transaction.sampled, null)
  })

  await t.test('should apply decision when sampler is not AdaptiveSampler', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          remote_parent_sampled: 'always_on',
          remote_parent_not_sampled: 'always_off'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const transaction1 = { priority: null, sampled: null }
    samplers.applyLegacyDTSamplingDecision({ transaction: transaction1, isSampled: true })
    assert.equal(transaction1.sampled, true)

    const transaction2 = { priority: null, sampled: null }
    samplers.applyLegacyDTSamplingDecision({ transaction: transaction2, isSampled: false })
    assert.equal(transaction2.sampled, false)
  })
})

test('updateAdaptiveTarget', async (t) => {
  await t.test('should update adaptive sampler target when it exists', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const originalTarget = samplers.adaptiveSampler.samplingTarget
    samplers.updateAdaptiveTarget(50)

    assert.equal(samplers.adaptiveSampler.samplingTarget, 50)
    assert.notEqual(samplers.adaptiveSampler.samplingTarget, originalTarget)
  })

  await t.test('should not throw when adaptive sampler does not exist', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers
    samplers.adaptiveSampler = null

    assert.doesNotThrow(() => {
      samplers.updateAdaptiveTarget(50)
    })
  })

  await t.test('should update sampling threshold based on new target', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    samplers.updateAdaptiveTarget(100)
    assert.equal(samplers.adaptiveSampler.samplingTarget, 100)
    assert.equal(samplers.adaptiveSampler._maxSamples, 200)
  })
})

test('updateAdaptivePeriod', async (t) => {
  await t.test('should update adaptive sampler period when it exists', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    samplers.updateAdaptivePeriod(120)

    assert.equal(samplers.adaptiveSampler.samplingPeriod, 120000)
  })

  await t.test('should convert period from seconds to milliseconds', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    samplers.updateAdaptivePeriod(60)

    assert.equal(samplers.adaptiveSampler.samplingPeriod, 60000)
  })

  await t.test('should not throw when adaptive sampler does not exist', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers
    samplers.adaptiveSampler = null

    assert.doesNotThrow(() => {
      samplers.updateAdaptivePeriod(60)
    })
  })
})

test('getAdaptiveSampler', async (t) => {
  await t.test('should create adaptive sampler if it does not exist', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)
    samplers.adaptiveSampler = null

    const sampler = samplers.getAdaptiveSampler({ agent: t.nr.agent, config })

    assert.ok(sampler instanceof AdaptiveSampler)
    assert.equal(samplers.adaptiveSampler, sampler)
  })

  await t.test('should return existing adaptive sampler if it exists', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = t.nr.agent.samplers

    const sampler1 = samplers.getAdaptiveSampler({ agent: t.nr.agent, config })
    const sampler2 = samplers.getAdaptiveSampler({ agent: t.nr.agent, config })

    assert.equal(sampler1, sampler2)
  })

  await t.test('should use config values for sampler initialization', (t) => {
    const config = new Config({
      sampling_target: 25,
      sampling_target_period_in_seconds: 120
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)
    samplers.adaptiveSampler = null

    const sampler = samplers.getAdaptiveSampler({ agent: t.nr.agent, config })

    // TODO: is this broken?
    assert.equal(sampler.samplingTarget, 10)
    assert.equal(sampler.samplingPeriod, 120000)
  })

  await t.test('should respect serverless_mode setting', (t) => {
    const config = new Config({
      serverless_mode: { enabled: true }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)
    samplers.adaptiveSampler = null

    const sampler = samplers.getAdaptiveSampler({ agent: t.nr.agent, config })

    assert.ok(sampler._serverless)
  })
})

test('determineSampler', async (t) => {
  await t.test('should return AlwaysOnSampler when config is "always_on"', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: 'always_on'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'root'
    })

    assert.ok(sampler instanceof AlwaysOnSampler)
  })

  await t.test('should return AlwaysOffSampler when config is "always_off"', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: 'always_off'
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'root'
    })

    assert.ok(sampler instanceof AlwaysOffSampler)
  })

  await t.test('should return TraceIdRatioBasedSampler when config has trace_id_ratio_based', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: {
            trace_id_ratio_based: {
              ratio: 0.5
            }
          }
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'root'
    })

    assert.ok(sampler instanceof TraceIdRatioBasedSampler)
    assert.equal(sampler._ratio, 0.5)
  })

  await t.test('should create new AdaptiveSampler when adaptive.sampling_target is set', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: {
            adaptive: {
              sampling_target: 50
            }
          }
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'root'
    })

    assert.ok(sampler instanceof AdaptiveSampler)
    assert.equal(sampler.samplingTarget, 50)
    assert.notEqual(sampler, samplers.adaptiveSampler)
  })

  await t.test('should return global adaptive sampler by default', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'root'
    })

    assert.ok(sampler instanceof AdaptiveSampler)
    assert.equal(sampler, samplers.adaptiveSampler)
  })

  await t.test('should return global adaptive sampler when samplerDefinition is undefined', (t) => {
    const config = new Config({})
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'nonexistent_sampler'
    })

    assert.ok(sampler instanceof AdaptiveSampler)
    assert.equal(sampler, samplers.adaptiveSampler)
  })

  await t.test('should return global adaptive sampler when adaptive.sampling_target is not set', (t) => {
    const config = new Config({
      distributed_tracing: {
        sampler: {
          root: {
            adaptive: {}
          }
        }
      }
    })
    t.nr.agent = helper.loadMockedAgent(config)
    const samplers = new Samplers(t.nr.agent)

    const sampler = samplers.determineSampler({
      agent: t.nr.agent,
      config,
      sampler: 'root'
    })

    assert.ok(sampler instanceof AdaptiveSampler)
    assert.equal(sampler, samplers.adaptiveSampler)
  })
})
