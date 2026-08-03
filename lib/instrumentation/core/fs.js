/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const record = require('../../metrics/recorders/generic')
const NAMES = require('../../metrics/names')
const { RecorderSpec } = require('../../shim/specs')
const securityChannels = require('../../security-channels')

// Operations that read from the filesystem (FILE_OPERATION / path traversal)
const FS_READ_OPS = new Set([
  'stat', 'lstat', 'fstat', 'readdir', 'readlink', 'realpath', 'open',
  'readFile', 'exists', 'close', 'read', 'fsync', 'fdatasync',
  'realpath.native', 'glob'
])

// Operations that write to or mutate the filesystem (FILE_INTEGRITY)
const FS_WRITE_OPS = new Set([
  'rename', 'truncate', 'ftruncate', 'chown', 'lchown', 'fchown',
  'chmod', 'lchmod', 'fchmod', 'link', 'symlink', 'unlink', 'rmdir',
  'mkdir', 'mkdtemp', 'utimes', 'futimes', 'writeFile', 'appendFile',
  'copyFile', 'write'
])

module.exports = initialize

function initialize(agent, fs, moduleName, shim) {
  const methods = [
    'rename',
    'truncate',
    'chown',
    'lchown',
    'fchown',
    'chmod',
    'lchmod',
    'fchmod',
    'stat',
    'lstat',
    'fstat',
    'link',
    'symlink',
    'readlink',
    'realpath',
    'unlink',
    'rmdir',
    'mkdir',
    'mkdtemp',
    'readdir',
    'close',
    'open',
    'utimes',
    'futimes',
    'fsync',
    'readFile',
    'writeFile',
    'appendFile',
    'exists',
    'ftruncate'
  ]

  if (Object.hasOwnProperty.call(fs, 'glob') === true) {
    // The `glob` method was added in Node 22.
    methods.push('glob')
  }

  const nonRecordedMethods = ['write', 'read']

  shim.record(fs, methods, recordFs)

  const originalExists = shim.getOriginal(fs.exists)
  for (const symbol of Object.getOwnPropertySymbols(originalExists)) {
    fs.exists[symbol] = originalExists[symbol]
  }

  fs.realpath.native = shim.getOriginal(fs.realpath).native

  shim.record(fs.realpath, 'native', function recordRealpathNative(shim, fn) {
    return recordFs(shim, fn, 'realpath.native')
  })

  shim.wrap(fs, nonRecordedMethods, function wrapNonRecordedFs(shim, fn) {
    return function wrappedNonRecordedFs(...args) {
      // these are called in tight loops so opting out early
      if (!shim.getActiveSegment()) {
        return fn.apply(this, args)
      }

      const cbIndex = args.length - 1

      shim.bindSegment(args, cbIndex)

      return fn.apply(this, args)
    }
  })

  shim.wrap(fs, ['watch', 'watchFile'], function wrapFsWatch(shim, fn) {
    return function wrappedFsWatch() {
      const result = fn.apply(this, arguments)
      shim.bindSegment(result, 'emit')

      return result
    }
  })

  function recordFs(shim, fn, name, args) {
    const path = args && args[0] != null ? String(args[0]) : null
    const transaction = path ? agent.tracer.getTransaction() : null

    if (transaction && path) {
      if (FS_READ_OPS.has(name) && securityChannels.fsReadStart.hasSubscribers) {
        securityChannels.fsReadStart.publish({ path, operation: name, flags: null, transaction, segment: shim.getActiveSegment() })
      } else if (FS_WRITE_OPS.has(name) && securityChannels.fsWriteStart.hasSubscribers) {
        const destinationPath = (name === 'rename' || name === 'copyFile') && args[1] != null ? String(args[1]) : null
        securityChannels.fsWriteStart.publish({ path, destinationPath, operation: name, transaction, segment: shim.getActiveSegment() })
      }
    }

    return new RecorderSpec({ name: NAMES.FS.PREFIX + name, callback: shim.LAST, recorder: record })
  }
}
