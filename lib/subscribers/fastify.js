/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const Subscriber = require('./base')
const InstrumentationDescriptor = require('../instrumentation-descriptor')
const shims = require('../shim')
const { buildMiddlewareSpecForRouteHandler } = require('../instrumentation/fastify/spec-builders')
const REQUEST_HOOKS = [
  'onRequest',
  'preParsing',
  'preValidation',
  'preHandler',
  'preSerialization',
  'onSend',
  'onResponse',
  'onError'
]


class FastifySubscriber extends Subscriber {
  constructor(agent) {
    super(agent, 'fastify:nr_addHook')
    this.config = agent.config
    this.requireActiveTx = false 
    this.events = ['asyncEnd']
    debugger
    //this.shim = shims.createShimFromType({ type: InstrumentationDescriptor.TYPES.WEB_FRAMEWORK, agent, moduleName: 'fastify', resolvedName: 'fastify' }) 
    //this.shim.setFramework(this.shim.FASTIFY)
  }

  handler(data, ctx) {
    const { self, arguments: args } = data
    const [hookName, middlewareFunction] = args
    if (hookName === 'onRoute') {
      args[1] = (routeOptions) => {
        console.log('onRoute called with routeOptions:', routeOptions)
      }
    }
    console.log('FastifySubscriber handler called with hookName:', hookName)
    /*debugger
    const [hookName, middlewareFunction ] = args
    if (hookName === 'onRoute') {
      debugger
      return
    }
    self.addHook('onRoute', (routeOptions) => {
      if (!routeOptions.handler) {
        return
      }
      /**
       * recordMiddleware handler call
       *
       * The WebFramework shim treats the main route handler like any other
       * i.e. dont be confused by the call to recordMiddleware -- we don't
       * have a recordRouteHandler, everything goes through recordMiddleware
       */
      /*const newRouteHandler = this.shim.recordMiddleware(
        routeOptions.handler,
        buildMiddlewareSpecForRouteHandler(this.shim, routeOptions.path)
      )

      routeOptions.handler = newRouteHandler

    })
    */
  }
}

const fastifyConfig = {
  package: 'fastify',
  instrumentations: [
    {
      channelName: 'nr_addHook',
      module: { name: 'fastify', versionRange: '>=2.0.0', filePath: 'fastify.js' },
      functionQuery: {
        functionName: 'addHook',
        kind: 'Sync'
      }
    }
  ]
}

module.exports = {
  fastifyConfig,
  FastifySubscriber
}
