/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { RecorderSpec } = require('../../../lib/shim/specs')
const securityChannels = require('../../security-channels')

module.exports = initialize

function initialize(agent, crypto, moduleName, shim) {
  shim.record(
    crypto,
    ['pbkdf2', 'randomBytes', 'pseudoRandomBytes', 'randomFill', 'scrypt'],
    function recordCryptoMethod(shim, fn, name) {
      return new RecorderSpec({
        name: 'crypto.' + name,
        callback: shim.LAST,
        callbackRequired: true // sync version used too heavily - too much overhead
      })
    }
  )

  // Publish security events for weak-algorithm detection — these functions are
  // synchronous and return immediately, so we wrap them directly.
  if (typeof crypto.createHash === 'function') {
    shim.wrap(crypto, 'createHash', function wrapCreateHash(shim, fn) {
      return function wrappedCreateHash(algorithm) {
        if (securityChannels.cryptoHashStart.hasSubscribers) {
          const transaction = agent.tracer.getTransaction()
          if (transaction) {
            securityChannels.cryptoHashStart.publish({ algorithm, transaction })
          }
        }
        return fn.apply(this, arguments)
      }
    })
  }

  if (typeof crypto.createCipheriv === 'function') {
    shim.wrap(crypto, 'createCipheriv', function wrapCreateCipheriv(shim, fn) {
      return function wrappedCreateCipheriv(algorithm) {
        if (securityChannels.cryptoCipherStart.hasSubscribers) {
          const transaction = agent.tracer.getTransaction()
          if (transaction) {
            securityChannels.cryptoCipherStart.publish({ algorithm, transaction })
          }
        }
        return fn.apply(this, arguments)
      }
    })
  }

  // Math.random weak-randomness detection
  if (securityChannels.cryptoRandom.hasSubscribers !== undefined) {
    shim.wrap(Math, 'random', function wrapMathRandom(shim, fn) {
      return function wrappedMathRandom() {
        if (securityChannels.cryptoRandom.hasSubscribers) {
          const transaction = agent.tracer.getTransaction()
          if (transaction) {
            securityChannels.cryptoRandom.publish({ api: 'Math.random', transaction })
          }
        }
        return fn.apply(this, arguments)
      }
    })
  }
}
