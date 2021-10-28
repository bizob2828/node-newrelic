/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

class LegacyContextMgr {
  constructor() {
    this._ctx = {
      segment: null
    }
  }

  runIn({ cb, store }) {
    const parent = this.active
    this._ctx = store
    try {
      return cb()
    } finally {
      this._ctx = parent
    }
  }

  get active() {
    return this._ctx
  }
}

module.exports = LegacyContextMgr
