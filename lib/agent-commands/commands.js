/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * Registry of agent command handlers keyed by the command name sent by the
 * collector. Each handler receives the agent and the command's `arguments` map
 * (defaulting to an empty object) and returns a result map. Throwing a
 * `CommandError` reports the failure back to the collector for that command id.
 */
const commands = {
  /**
   * Start a profiling session.
   *
   * @param {Agent} agent New Relic agent
   * @returns {Promise<object>} empty result map
   */
  async start_profiler(agent) {
    agent.config.profiling.enabled = true
    await agent.profilingData.initSourceMapper()
    agent.profilingData.reconfigure(agent.config)
    agent.profilingData.start()
    return {}
  },

  /**
   * Stop a running profiling session.
   *
   * @param {Agent} agent New Relic agent
   * @returns {Promise<object>} empty result map
   */
  async stop_profiler(agent) {
    await agent.profilingData.collectData()
    agent.profilingData.stop()
    agent.profilingData.end()
    return {}
  }
}

module.exports = { commands }
