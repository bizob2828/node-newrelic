'use strict'
const ApplicationLogSubscriber = require('../application-logs')
const Stream = require('node:stream')
const NrTransport = require('../../instrumentation/nr-winston-transport')

function isStream(obj) {
  return obj instanceof Stream
}

class CreateLogger extends ApplicationLogSubscriber {
  constructor({ agent ,logger }) {
    super({ agent, logger, packageName: 'winston', channelName: 'nr_loggerAdd' })
    this.events = ['end']
  }

  handler(data, ctx) {
    const self = this
    this.createModuleUsageMetric(this.packageName)
    const origWrite = data.self.write
    data.self.write = function wrappedWrite(chunk) {
      console.log('incrementing lines', chunk.level)
      self.incrementLinesMetric(chunk.level)
      return origWrite.apply(this, arguments)
    }
    return ctx
  }
  end(data) {
    if (this.isLogForwardingEnabled() && data.self.transports.some(transport => !(transport instanceof NrTransport))) {
      data.self.add(new NrTransport({ agent: this.agent }))
    }
  }

  /**
   * Does the necessary instrumentation depending on application_logging configuration.
   * It will register a formatter to track metrics or decorate message in formatter(if local log decoration)
   * and register a transport do to the log forwarding
   *
   * @param {object} params object passed to function
   * @param {object} params.obj instance of winston logger
   * @param {Array} params.args arguments passed to the logger creation method(createLogger or logger.add)
   * @param {object} params.opts the logger options argument
   * @param {Agent} params.agent NR instance
   * @param {object} params.winston the winston export
   * @param {Shim} params.shim shim instance
   * @param {Function} params.registerLogger the function to create winston logger
   * @returns {object} the winston logger instance with relevant instrumentation
   */
  performInstrumentation({ obj, args, opts, agent, winston, shim, registerLogger }) {
    const config = agent.config

    createModuleUsageMetric('winston', agent.metrics)

    if (isLocalDecoratingEnabled(config) || isMetricsEnabled(config)) {
      registerFormatter({ opts, agent, winston })
    }

    const winstonLogger = registerLogger.apply(obj, args)

    if (isLogForwardingEnabled(config, agent)) {
      winstonLogger.add(new NrTransport({ agent }))
      wrapConfigure({ shim, winstonLogger, agent })
    }

    return winstonLogger
  }
}

module.exports = CreateLogger
