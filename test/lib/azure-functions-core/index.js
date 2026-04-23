/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
// put on global as this gets required and we cannot mock
// because our instrumentation loads this fake package
global.logHandlers = []
function FunctionsCore() {}
FunctionsCore.prototype.registerHook = function registerHook(hookName, callback) {
  global.logHandlers.push(callback)
}

FunctionsCore.prototype.registerFunction = function registerFunction(metadata, callback) {
}

FunctionsCore.prototype.log = function log(level, categroy, message) {
}

let pModel
FunctionsCore.prototype.setProgrammingModel = function setProgrammingModel(model) {
  pModel = model
}

FunctionsCore.prototype.getProgrammingModel = function getProgrammingModel() {
  return pModel
}

module.exports = new FunctionsCore()
