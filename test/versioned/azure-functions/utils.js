/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { execSync } = require('node:child_process')
const path = require('node:path')
function copyFakeCorePkg() {
  const pkgPath = path.resolve(__dirname, '../../lib/azure-functions-core')
  const destPath = path.resolve(__dirname, 'node_modules/@azure/functions-core')
  execSync(`rm -rf ${destPath}`)
  execSync(`cp -r ${pkgPath} ${destPath}`)
}

module.exports = { copyFakeCorePkg }
