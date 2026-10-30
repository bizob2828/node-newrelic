/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const BaseCoreSubscriber = require('./base')
const { wrapMethod } = require('../wrap-method')
const Transaction = require('#agentlib/transaction/index.js')
const recordWeb = require('#agentlib/metrics/recorders/http.js')
const synthetics = require('#agentlib/synthetics.js')
const symbols = require('#agentlib/symbols.js')
const urltils = require('#agentlib/util/urltils.js')
const NAMES = require('#agentlib/metrics/names.js')

const SERVER_ON_REQUEST = 'Server.onrequest'

/**
 * Instruments the server half of the `http`/`https` core modules: wraps
 * `createServer`, starts a transaction and base segment on the `'request'`
 * event, and ends that segment (plus finalizes the transaction's web data)
 * when the response finishes.
 */
class HttpSubscriber extends BaseCoreSubscriber {
  constructor({ agent, logger, packageName }) {
    super({
      agent,
      logger,
      packageName: packageName ?? 'http',
      instrumentedMethods: [SERVER_ON_REQUEST]
    })

    // There is necessarily no active transaction yet when a request comes in
    // -- this subscriber is what creates one.
    this.requireActiveTx = false
  }

  get transport() {
    return this.packageName === 'https' ? 'HTTPS' : 'HTTP'
  }

  /**
   * Creates the transaction and base segment for an inbound request, or, in
   * the unusual case that a transaction is already active, skips creating a
   * nested one -- mirroring the former `tracer.transactionProxy` behavior.
   *
   * @param {object} data Event data published to the `start` event.
   * @param {http.IncomingMessage} data.request The inbound request.
   * @param {http.ServerResponse} data.response The outbound response.
   * @param {number|null} data.port The port the server is listening on.
   * @param {object} ctx The current async context.
   * @returns {object} The updated context, entered into the new transaction
   * and base segment, or the original context when no transaction should be
   * created.
   */
  handler(data, ctx) {
    if (!this.agent.canCollectData()) {
      return ctx
    }

    if (ctx.transaction) {
      this.logger.warn(
        {
          transaction: { id: ctx.transaction.id, name: ctx.transaction.getName() },
          segment: ctx.segment?.name
        },
        'Active transaction when creating non-nested transaction'
      )
      this.agent.recordSupportability('Nodejs/Transactions/Nested')
      return ctx
    }

    const { request, response, port } = data
    const transaction = new Transaction(this.agent)
    const txCtx = ctx.enterTransaction(transaction)

    // Everything below -- segment creation, `initializeWeb` (which, via
    // `header-attributes.js`, reads the "current" segment off the tracer
    // rather than taking one as a parameter), and the emitter binding --
    // needs to run with `txCtx` (segment: the transaction's root) actually
    // active in the async-local-storage context, not just computed locally.
    // `channel.traceSync` only applies whatever context `handler` *returns*
    // once this call is done, so that work is scoped inside its own
    // `runInContext` call here instead.
    return this.agent.tracer.runInContext({
      handler: this.#setUpTransaction.bind(this, { transaction, request, response, port, ctx: txCtx }),
      context: txCtx,
      full: true,
      thisArg: this,
      args: []
    })
  }

  /**
   * Finishes setting up the transaction and base segment started by
   * {@link #handler}, with `ctx` (segment: the transaction's root) already
   * the active async context.
   *
   * @param {object} params Function parameters.
   * @param {Transaction} params.transaction The newly created transaction.
   * @param {http.IncomingMessage} params.request The inbound request.
   * @param {http.ServerResponse} params.response The outbound response.
   * @param {number|null} params.port The port the server is listening on.
   * @param {object} params.ctx The async context entered into `transaction`,
   * with its root segment active.
   * @returns {object} The context entered into the new base segment -- what
   * {@link #handler} returns, and so what the inbound request is ultimately
   * dispatched to its listeners under.
   */
  #setUpTransaction({ transaction, request, response, port, ctx }) {
    transaction.nameState.setPrefix(NAMES.NODEJS.PREFIX)
    transaction.nameState.setDelimiter(NAMES.ACTION_DELIMITER)
    if (request.method != null) {
      transaction.nameState.setVerb(request.method)
    }

    const newCtx = this.createSegment({ name: request.url, recorder: recordWeb, ctx })
    transaction.baseSegment = newCtx.segment

    const txInfo = this.#storeTxInfo(transaction, request, response)
    if (txInfo) {
      // Seed segment stack to enable parenting logic leveraged by
      // web framework instrumentations.
      txInfo.segmentStack.push(newCtx.segment)
    }

    const absoluteUrl = this.#resolveAbsoluteUrl(request)
    transaction.initializeWeb({
      absoluteUrl,
      method: request.method,
      port,
      headers: request.headers,
      transport: this.transport
    })

    /* Needed for Connect and Express middleware that monkeypatch request
     * and response via listeners.
     */
    this.agent.tracer.bindEmitter(request, newCtx.segment)
    this.agent.tracer.bindEmitter(response, newCtx.segment)

    const onResponseDone = () => {
      // 'finish' and 'close' can both fire for the same response; remove
      // both listeners so this doesn't run twice.
      response.removeListener('finish', onResponseDone)
      response.removeListener('close', onResponseDone)
      this.#instrumentedFinish(response, transaction)
    }
    response.once('finish', onResponseDone)
    response.once('close', onResponseDone)

    return newCtx
  }

  /**
   * Resolves the absolute URL of the inbound request, handling requests
   * made to a proxy URL.
   *
   * @param {http.IncomingMessage} request The inbound request.
   * @returns {string} The resolved absolute URL.
   */
  #resolveAbsoluteUrl(request) {
    if (request?.url.startsWith('http://') || request?.url.startsWith('https://')) {
      return request.url
    }
    return `${this.transport}://${request.headers.host || 'localhost'}${request.url}`
  }

  /**
   * Stores the transaction info relied upon by web framework instrumentation
   * on both the request and response.
   *
   * @param {Transaction} transaction The active transaction.
   * @param {http.IncomingMessage} request The inbound request.
   * @param {http.ServerResponse} response The outbound response.
   * @returns {object|undefined} The stored transaction info, or `undefined`
   * when `request`/`response` are missing.
   */
  #storeTxInfo(transaction, request, response) {
    if (!request || !response) {
      this.logger.debug('Missing request or response object! Not storing transaction info.')
      return
    }

    const txInfo = {
      transaction,
      segmentStack: [],
      errorHandled: false,
      error: null
    }
    request[symbols.transactionInfo] = response[symbols.transactionInfo] = txInfo

    this.logger.trace('Stored transaction %s information on request and response', transaction.id)

    return txInfo
  }

  /**
   * Adds `http.statusCode`/`http.statusText` to the transaction trace and
   * span, and assigns the response headers to the transaction, once the
   * response has finished or closed.
   *
   * @param {http.ServerResponse} response The outbound response.
   * @param {Transaction} transaction The active transaction.
   */
  #instrumentedFinish(response, transaction) {
    transaction.finalizeWeb({
      end: true,
      statusCode: response.statusCode,
      statusMessage: response.statusMessage,
      headers: response.getHeaders()
    })
  }

  /**
   * Gets the port from the `Server` object.
   *
   * @param {object} server The `http`/`https` server.
   * @returns {number|null} The parsed port.
   */
  #parsePort(server) {
    let serverPort = null
    if (server.address instanceof Function) {
      const address = server.address()
      if (address) {
        serverPort = address.port
      }
    }
    return serverPort
  }

  instrument(http) {
    if (process.env.FUNCTIONS_WORKER_RUNTIME) {
      this.logger.debug('In azure functions environment, disabling core http instrumentation in favor of @azure/functions')
      return
    }

    this.#wrapCreateServer(http)

    if (http.Server?.prototype) {
      this.#wrapEmit(http.Server.prototype)
    }

    // `https` has no `ServerResponse`/`IncomingMessage` of its own -- requests
    // received over TLS are still served with `http.ServerResponse` instances,
    // which are wrapped once via the `http` subscriber.
    if (http.ServerResponse?.prototype) {
      this.#wrapResponseEnd(http.ServerResponse.prototype)
      this.#wrapWriteHead(http.ServerResponse.prototype)
    }
  }

  #wrapCreateServer(http) {
    const agent = this.agent
    wrapMethod({
      module: http,
      methodName: 'createServer',
      logger: this.logger,
      wrapper: function wrapCreateServer(createServer) {
        return function setDispatcher(requestListener) {
          agent.environment.setDispatcher('http')
          return createServer.apply(this, arguments)
        }
      }
    })
  }

  #wrapEmit(serverProto) {
    const self = this
    const [channel] = this.channels
    const packageName = this.packageName

    wrapMethod({
      module: serverProto,
      methodName: 'emit',
      logger: this.logger,
      wrapper: function wrapEmit(emit) {
        return function wrappedEmit(evnt, request, response) {
          if (evnt !== 'request') {
            return emit.apply(this, arguments)
          }

          const data = {
            name: `${packageName}.${SERVER_ON_REQUEST}`,
            request,
            response,
            port: self.#parsePort(this)
          }
          return channel.traceSync(emit, data, this, ...arguments)
        }
      }
    })
  }

  #wrapResponseEnd(proto) {
    const agent = this.agent

    wrapMethod({
      module: proto,
      methodName: 'end',
      logger: this.logger,
      wrapper: function wrapResEnd(end) {
        return function wrappedResEnd() {
          const txInfo = this && this[symbols.transactionInfo]
          if (!txInfo) {
            return end.apply(this, arguments)
          }

          if (!txInfo.transaction.isActive()) {
            return end.apply(this, arguments)
          }

          // If an error happened, add it to the aggregator.
          if (
            txInfo.error &&
            (!txInfo.errorHandled || urltils.isError(agent.config, this.statusCode))
          ) {
            agent.errors.add(txInfo.transaction, txInfo.error)
          }

          // End all the segments leading up to and including this one.
          for (let i = txInfo.segmentStack.length - 1; i >= 0; --i) {
            txInfo.segmentStack[i].end()
          }
          const segment = agent.tracer.getSegment()
          if (segment) {
            segment.end()
          }

          // Freeze the name state to prevent further changes.
          txInfo.transaction.nameState.freeze()

          return end.apply(this, arguments)
        }
      }
    })
  }

  #wrapWriteHead(proto) {
    const agent = this.agent

    wrapMethod({
      module: proto,
      methodName: 'writeHead',
      logger: this.logger,
      wrapper: function wrapWriteHead(writeHead) {
        return function wrappedWriteHead() {
          const transaction = agent.tracer.getTransaction()
          if (!transaction) {
            return writeHead.apply(this, arguments)
          }

          // Adds synthetics headers to the response headers.
          synthetics.assignHeadersToResponse(this, transaction)

          return writeHead.apply(this, arguments)
        }
      }
    })
  }
}

module.exports = HttpSubscriber
