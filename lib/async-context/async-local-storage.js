/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { AsyncLocalStorage } = require('async_hooks')

class AsyncContextMgr {
  constructor() {
    this._store = new AsyncLocalStorage()
    this._ctx = {
      segment: null
    }
  }

  runIn({ cb, store = this.active }) {
    return this._store.run(store, cb)
  }

  get active() {
    return this._store.getStore() || this._ctx
  }
}

module.exports = AsyncContextMgr
