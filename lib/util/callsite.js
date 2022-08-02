'use strict'
const path = require('path')
const agentPath = path.resolve(__dirname, '..', '..')

function filterAgentFiles(callsite) {
  debugger
  const fileName = callsite.getFileName()
  if (!fileName) {
    return false
  }
  let index = fileName.indexOf(agentPath)
  if (index === 0) {
    index = fileName.indexOf(`${agentPath}/test`)
    if (index === 0) {
      index = fileName.indexOf('node_modules')
      return index < 0
    }
  } else {
    index = fileName.indexOf('node:')
    return index < 0
  }
}

module.exports = function getCallsite() {
  const origPrepareStackTrace = Error.prepareStackTrace
  const origStackLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 50
  Error.prepareStackTrace = (err, stack) => stack
  const stack = new Error().stack
  Error.prepareStackTrace = origPrepareStackTrace
  Error.stackTraceLimit = origStackLimit
  return stack.filter(filterAgentFiles).map((callsite) => {
    return {
      filepath: callsite.getFileName(),
      function: callsite.getFunctionName(),
      lineno: callsite.getLineNumber(),
      column: callsite.getColumnNumber()
    }
  })
}
