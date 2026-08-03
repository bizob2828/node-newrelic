/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { RecorderSpec } = require('../../../lib/shim/specs')
const securityChannels = require('../../security-channels')

module.exports = initialize

function initialize(agent, childProcess, moduleName, shim) {
  if (!childProcess) {
    shim.logger.debug('Could not find child_process, not instrumenting')
    return false
  }

  const methods = ['exec', 'execFile']

  shim.record(childProcess, methods, function recordExec(shim, fn, name, args) {
    const command = args && args[0] != null ? String(args[0]) : null
    const transaction = command ? agent.tracer.getTransaction() : null

    if (transaction && command && securityChannels.childProcessStart.hasSubscribers) {
      securityChannels.childProcessStart.publish({
        command,
        args: [],
        shell: name === 'exec',
        operation: name,
        transaction,
        segment: shim.getActiveSegment()
      })
    }

    // Wrap the original callback to publish childProcessFinish when the process exits
    if (transaction && command && securityChannels.childProcessFinish.hasSubscribers) {
      const cbIdx = args.length - 1
      if (typeof args[cbIdx] === 'function') {
        const originalCb = args[cbIdx]
        args[cbIdx] = function wrappedExecCallback(error) {
          securityChannels.childProcessFinish.publish({
            command,
            exitCode: null,
            error: error || null,
            transaction
          })
          return originalCb.apply(this, arguments)
        }
      }
    }

    return new RecorderSpec({ name: 'child_process.' + name, callback: shim.LAST })
  })

  makePromisifyCompatible(shim, childProcess)
}

function makePromisifyCompatible(shim, childProcess) {
  const originalExec = shim.getOriginal(childProcess.exec)
  for (const symbol of Object.getOwnPropertySymbols(originalExec)) {
    childProcess.exec[symbol] = originalExec[symbol]
  }

  const originalExecFile = shim.getOriginal(childProcess.execFile)
  for (const symbol of Object.getOwnPropertySymbols(originalExecFile)) {
    childProcess.execFile[symbol] = originalExecFile[symbol]
  }
}
