/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const BaseSubscriber = require('../base')

module.exports = class WhenSubscriber extends BaseSubscriber {
  constructor({ agent, logger }) {
    super({ agent, logger, channelName: 'nr_then', packageName: 'when' })
    this.events = ['end']
  }

  handler(data, ctx) {
    const { arguments: args } = data
    const [onFulfilled, onRejected, onProgress] = args
    if (onFulfilled) {
      args[0] = this.agent.tracer.bindFunction(onFulfilled, ctx, true)
    }

    if (onRejected) {
      args[1] = this.agent.tracer.bindFunction(onRejected, ctx, true)
    }

    if (onProgress) {
      args[2] = this.agent.tracer.bindFunction(onProgress, ctx, true)
    }

    return ctx
  }
}
