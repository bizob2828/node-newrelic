/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const stringify = require('json-stringify-safe')
const urltils = require('../util/urltils.js')
const {
  params: { DatastoreParameters }
} = require('../../lib/shim/specs')
// eslint-disable-next-line n/no-unsupported-features/node-builtins
const diagCh = require('node:diagnostics_channel')
// eslint-disable-next-line n/no-unsupported-features/node-builtins
const channels = diagCh.tracingChannel('nr-ch')
const recordOperationMetrics = require('../../lib/metrics/recorders/database-operation')

module.exports = function initialize(agent, Redis, moduleName, shim) {
  shim.setDatastore(shim.REDIS)
  channels.start.bindStore(agent.tracer._contextManager._asyncLocalStorage, (data) => {
    const { thisArg, args } = data
    const [command] = args
    const parameters = new DatastoreParameters({
      host: thisArg.connector.options.host,
      port_path_or_id: thisArg.connector.options.port
    })

    const keys = command.args
    if (keys && typeof keys !== 'function') {
      const src = Object.create(null)
      try {
        src.key = stringify(keys[0])
      } catch (err) {
        shim.logger.debug(err, 'Failed to stringify ioredis key')
        src.key = '<unknown>'
      }
      urltils.copyParameters(src, parameters)
    }

    const ctx = agent.tracer.getContext()
    if (ctx?.transaction) {
      const segment = agent.tracer.createSegment({
        name: shim._metrics.OPERATION + command.name,
        parent: ctx.segment,
        recorder: recordOperationMetrics.bind(shim),
        transaction: ctx.transaction
      })
      for (const [key, value] of Object.entries(parameters)) {
        segment.addAttribute(key, value)
      }
      const newCtx = ctx.enterSegment({ segment })
      return newCtx
    }
  })
  channels.subscribe({
    asyncEnd(message) {
      const ctx = agent.tracer.getContext()
      ctx?.segment?.end()
    }
  })

  if (!Redis?.prototype) {
    return false
  }

  shim.wrap(Redis.prototype, 'sendCommand', function wrapSendCommand(shim, orig) {
    return function wrappedSendCommand() {
      return channels.tracePromise(orig, { thisArg: this, args: arguments }, this, ...arguments)
    }
  })
}
