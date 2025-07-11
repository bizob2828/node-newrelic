/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const logger = require('../logger').child({ component: 'span_aggregator' })
const EventAggregator = require('../aggregators/event-aggregator')
const SpanEvent = require('./span-event')
const NAMES = require('../metrics/names')

const DEFAULT_SPAN_EVENT_LIMIT = 2000
// Used only when server value missing
const SPAN_EVENT_FALLBACK_MAX_LIMIT = 10000

class SpanEventAggregator extends EventAggregator {
  constructor(opts, agent) {
    opts = opts || {}
    opts.method = opts.method || 'span_event_data'
    opts.metricNames = opts.metricNames || NAMES.SPAN_EVENTS

    super(opts, agent)
    this.inProcessSpans = agent.config.distributed_tracing.in_process_spans.enabled
  }

  _toPayloadSync() {
    const events = this.events

    if (events.length === 0) {
      logger.debug('No span events to send.')
      return
    }

    const metrics = {
      reservoir_size: events.limit,
      events_seen: events.seen
    }
    const eventData = events.toArray()

    return [this.runId, metrics, eventData]
  }

  start() {
    logger.debug('starting SpanEventAggregator')
    return super.start()
  }

  send() {
    if (logger.traceEnabled()) {
      logger.trace(
        {
          spansCollected: this.length,
          spansSeen: this.seen
        },
        'Entity stats on span harvest'
      )
    }
    super.send()
  }

  /**
   * Attempts to add the given segment to the collection.
   *
   * @param {object} params to function
   * @param {TraceSegment} params.segment segment to add.
   * @param {Transaction} params.transaction active transaction
   * @param {string} [params.parentId] GUID of the parent span.
   * @param {boolean} params.isRoot if segment is root segment
   */
  addSegment({ segment, transaction, parentId, isRoot }) {
    // Check if the priority would be accepted before creating the event object.

    if (transaction.priority < this._items.getMinimumPriority()) {
      ++this.events.seen
      this._metrics.getOrCreateMetric(this._metricNames.SEEN).incrementCallCount()

      return false
    }
    const span = SpanEvent.fromSegment({ segment, transaction, parentId, isRoot, inProcessSpans: this.inProcessSpans })

    if (span) {
      this.add(span, transaction.priority)
    }
  }

  /**
   * Reconfigure the `SpanEventAggregator` based on values from server
   *
   * @param {Config} config
   */
  reconfigure(config) {
    super.reconfigure(config)

    const { periodMs, limit } = this._getValidSpanConfiguration(config)

    this.periodMs = periodMs
    this.limit = limit
    this._metrics.getOrCreateMetric(this._metricNames.LIMIT).recordValue(this.limit)
    this._items.setLimit(this.limit)
  }

  /**
   * Retrieves report period and harvest limits defined in `span_event_harvest_config`.
   * When no `span_event_harvest_config` has been received from the server, applies an
   * agent-defined fallback maximum to protect against collecting and sending too many spans.
   *
   * @param {Config} config
   */
  _getValidSpanConfiguration(config) {
    const spanHarvestConfig = config.span_event_harvest_config
    if (spanHarvestConfig) {
      logger.trace('Using span_event_harvest_config values.')

      return {
        periodMs: spanHarvestConfig.report_period_ms,
        limit: spanHarvestConfig.harvest_limit
      }
    }

    const configuredLimit = config.span_events.max_samples_stored || DEFAULT_SPAN_EVENT_LIMIT

    return {
      periodMs: this.defaultPeriod,
      limit: _enforceMaxLimit(configuredLimit, SPAN_EVENT_FALLBACK_MAX_LIMIT)
    }
  }
}

function _enforceMaxLimit(currentLimit, maxLimit) {
  let spanLimit = currentLimit
  if (spanLimit > maxLimit) {
    spanLimit = maxLimit

    logger.debug('Using maximum allowed span event limit of %s', maxLimit)
  }

  return spanLimit
}

module.exports = SpanEventAggregator
