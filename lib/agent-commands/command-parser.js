/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const defaultLogger = require('../logger').child({ component: 'command_parser' })
const { commands } = require('./commands')

/**
 * Implements the Agent Commands execution loop. Each harvest cycle the parser:
 *   1. retries any command results that previously failed to send,
 *   2. polls `get_agent_commands` for new commands,
 *   3. executes each command, collecting a result map keyed by command id, and
 *   4. posts the results to `agent_command_results`.
 *
 * See the Agent Commands spec for the full behavior.
 *
 * @class
 */
class CommandParser {
  constructor({ agent }, { logger = defaultLogger } = {}) {
    this.agent = agent
    this.logger = logger

    // Serverless mode does not poll the collector, so agent commands are disabled there.
    this.enabled = agent.config.serverless_mode.enabled === false

    // Result maps that failed to send on a prior harvest, awaiting retry.
    this.backlog = []
  }

  /**
   * Runs one iteration of the execution loop. Called once per harvest cycle.
   *
   * @returns {Promise<void>}
   */
  async runCommands() {
    if (!this.enabled) {
      return
    }

    await this._retryBacklog()

    let rawCommands
    try {
      rawCommands = await this._fetchCommands()
    } catch (err) {
      // A fetch failure is logged and swallowed; commands are retried next harvest.
      this.logger.warn(err, 'Failed to fetch agent commands, will retry next harvest.')
      return
    }

    const results = await this._processCommands(rawCommands)

    if (Object.keys(results).length > 0) {
      const { error, response } = await this._postResults(results)
      // On a fresh send, keep the results for retry on a transport error or when
      // the collector indicates the data should be retained.
      if (error || (response && response.retainData)) {
        this.backlog.push(results)
      }
    }
  }

  /**
   * Walks the backlog of previously-unsent results and retries each one. On
   * success the entry is dropped; on an HTTP error the collector response code
   * decides keep-vs-discard; on any other exception the entry is discarded.
   *
   * @returns {Promise<void>}
   */
  async _retryBacklog() {
    if (this.backlog.length === 0) {
      return
    }

    const pending = this.backlog
    this.backlog = []

    for (const results of pending) {
      const { error, response } = await this._postResults(results)
      if (!error && response && response.retainData) {
        // HTTP error the collector wants us to retry.
        this.backlog.push(results)
      }
      // success (drop) and any other exception (discard) fall through.
    }
  }

  /**
   * Processes agent commands delivered in-band via a collector response payload.
   * Skips polling; otherwise mirrors the backlog-retry → process → post-results
   * flow of `runCommands()`.
   *
   * @param {Array} rawCommands list of `[id, { name, arguments }]` pairs
   * @returns {Promise<void>}
   */
  async processInbandCommands(rawCommands) {
    if (!this.enabled) {
      return
    }

    await this._retryBacklog()

    const results = await this._processCommands(rawCommands)

    if (Object.keys(results).length > 0) {
      const { error, response } = await this._postResults(results)
      if (error || (response && response.retainData)) {
        this.backlog.push(results)
      }
    }
  }

  /**
   * Polls the collector for new agent commands.
   *
   * @returns {Promise<Array>} list of `[id, { name, arguments }]` pairs
   */
  _fetchCommands() {
    return new Promise((resolve, reject) => {
      this.agent.collector.getAgentCommands((error, response) => {
        if (error) {
          reject(error)
          return
        }
        resolve((response && response.payload) || [])
      })
    })
  }

  /**
   * Posts a result map to the collector.
   *
   * @param {object} results map of command id to result
   * @returns {Promise<{error: Error, response: object}>} the raw send outcome
   */
  _postResults(results) {
    return new Promise((resolve) => {
      this.agent.collector.sendCommandResults(results, (error, response) => {
        resolve({ error, response })
      })
    })
  }

  /**
   * Executes each command and collects a result map keyed by command id.
   *
   * @param {Array} rawCommands list of `[id, { name, arguments }]` pairs
   * @returns {Promise<object>} map of command id to result
   */
  async _processCommands(rawCommands) {
    const results = {}

    for (const command of rawCommands) {
      const result = await this._processCommand(command)
      if (result) {
        results[result.id] = result.value
      }
    }

    return results
  }

  /**
   * Executes a single command. Malformed commands are logged and skipped (no
   * result). Unknown commands and handler failures produce a JSON exception
   * result reported under the command id.
   *
   * @param {Array} command a `[id, { name, arguments }]` pair
   * @returns {Promise<{id: number, value: object}|null>} the result, or null to
   * report nothing
   */
  async _processCommand(command) {
    if (!Array.isArray(command) || command.length < 2 || command[1] == null) {
      this.logger.warn('Skipping malformed agent command: %s', JSON.stringify(command))
      return null
    }

    const [id, { name, arguments: args = {} }] = command

    if (typeof name !== 'string') {
      this.logger.warn('Skipping agent command %s with missing name.', id)
      return null
    }

    const handler = commands[name]
    if (!handler) {
      this.logger.warn('Received unknown agent command "%s".', name)
      return { id, value: { error: `Unknown command "${name}"` } }
    }

    try {
      const value = await handler(this.agent, args)
      return { id, value }
    } catch (err) {
      this.logger.warn(err, 'Agent command "%s" failed.', name)
      return { id, value: { error: err.message } }
    }
  }
}

module.exports = CommandParser
