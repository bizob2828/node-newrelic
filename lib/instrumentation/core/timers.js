/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

module.exports = initialize

function initialize(agent, timers, moduleName, shim) {
  if (agent.config.feature_flag.use_legacy_context) {
    instrumentCoreProcess()
  }

  instrumentTimerMethods(timers)

  // If we need to instrument separate references to timers on the global object,
  // do that now.
  if (!shim.isWrapped(global.setTimeout)) {
    instrumentTimerMethods(global)
  }

  function instrumentCoreProcess() {
    const processMethods = ['nextTick', '_nextDomainTick', '_tickDomainCallback']

    shim.wrap(process, processMethods, function wrapProcess(shim, fn) {
      return function wrappedProcess() {
        const segment = shim.getActiveSegment()
        if (!segment) {
          return fn.apply(this, arguments)
        }

        // Manual copy because helper methods add significant overhead in some usages
        const len = arguments.length
        const args = new Array(len)
        for (let i = 0; i < len; ++i) {
          args[i] = arguments[i]
        }

        shim.bindSegment(args, shim.FIRST, segment)

        return fn.apply(this, args)
      }
    })
  }
  function instrumentTimerMethods(nodule) {
    const asynchronizers = ['setTimeout', 'setInterval']

    shim.record(nodule, asynchronizers, recordAsynchronizers)

    // We don't want to create segments for setImmediate calls, as the
    // object allocation may incur too much overhead in some situations
    // TODO: not need with async local storage
    if (agent.config.feature_flag.use_legacy_context) {
      shim.wrap(nodule, 'setImmediate', wrapSetImmediate)
    }

    shim.wrap(nodule, 'clearTimeout', wrapClearTimeout)

    makeWrappedPromisifyCompatible(shim, nodule)
  }

  function wrapSetImmediate(shim, fn) {
    return function wrappedSetImmediate() {
      const segment = shim.getActiveSegment()
      if (!segment) {
        return fn.apply(this, arguments)
      }

      const args = shim.argsToArray.apply(shim, arguments, segment)
      shim.bindSegment(args, shim.FIRST)

      return fn.apply(this, args)
    }
  }

  function wrapClearTimeout(shim, fn) {
    return function wrappedClearTimeout(timer) {
      if (timer && timer._onTimeout) {
        // TODO: we will prob still need this even with the
        // async local storage ctx mgr.  we should at the very
        // least be using a symbol for this stuff, and find
        // cases where we _need_ it, do not always attach
        const segment = timer._onTimeout.__NR_segment
        if (segment && !segment.opaque) {
          segment.ignore = true
        }
      }

      return fn.apply(this, arguments)
    }
  }

  function recordAsynchronizers(shim, fn, name) {
    return { name: 'timers.' + name, callback: shim.FIRST }
  }
}

function makeWrappedPromisifyCompatible(shim, timers) {
  const originalSetTimeout = shim.getOriginal(timers.setTimeout)
  Object.getOwnPropertySymbols(originalSetTimeout).forEach((symbol) => {
    timers.setTimeout[symbol] = originalSetTimeout[symbol]
  })

  const originalSetInterval = shim.getOriginal(timers.setInterval)
  Object.getOwnPropertySymbols(originalSetInterval).forEach((symbol) => {
    timers.setInterval[symbol] = originalSetInterval[symbol]
  })

  if (shim.agent.config.feature_flag.use_legacy_context) {
    const originalSetImmediate = shim.getOriginal(timers.setImmediate)
    Object.getOwnPropertySymbols(originalSetImmediate).forEach((symbol) => {
      timers.setImmediate[symbol] = originalSetImmediate[symbol]
    })
  }
}
