/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { AsyncLocalStorage } = require('async_hooks')
const EventEmitter = require('events')

class AsyncContext {
  constructor() {
    this._ctx = new AsyncLocalStorage()
  }

  runIn({ cb, store = this.active }) {
    return this._ctx.run(store, cb)
  }

  bind(target, store) {
    if (target instanceof EventEmitter) {
      return this.bindEventEmitter(target, store)
    }
  }

  get active() {
    return this._ctx.getStore()
  }
}

module.exports = new AsyncContext()
