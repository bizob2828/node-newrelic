'use strict'
const logger = require('../../logger').child({ component: 'elasticsearch' })
const semver = require('semver')

// This is not instrumenting where as using API it is
// I suspect this needs to be in an onResolve hook

module.exports = function initialize(agent, elasticsearch, moduleName, shim) {
  function queryParser(params) {
    debugger
    // TODO: depending on the elastic search request the params need
    // further logic applied to determin the operation
    params = JSON.parse(params)
    const path = params.path.split('/')
    return {
      collection: path?.[1],
      operation: path?.[2]?.replace('_', ''),
      query: JSON.stringify(params?.body?.query)
    }
    debugger
  }
  shim.setDatastore("elastic");
  shim.setParser(queryParser)
  // cwd is node_modules/@elastic/elasticsearch w/ shim.require so use the relative path
  const { Transport } = elastic
  //const ClientLibrary = elastic.Client

  /*shim.recordOperation(ClientLibrary.BaseConnectionPool.prototype, 'addConnection', function wrapAddConnection(shim, fn, fnName, args) {
      debugger
      const parameters = {'host': args[0]};
      const newArgs = [args[0], fn];

      return {
          fnName,
          parameters,
          callback: function bindCallback(shim, _f, _n, segment) {
              shim.bindCallbackSegment(newArgs, shim.SECOND, segment)
          }
      }
  })
  */

  shim.recordQuery(Transport.prototype, 'request', function(shim, request, name, args) {
      debugger
      return {
        query: JSON.stringify(args?.[0]),
        promise: true
      }
  })
}
