/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { performance } = require('node:perf_hooks')
const isTimeInput = require('../utils/is-time-input.js')
const { ATTR_VALUE_LENGTH_LIMIT } = require('../constants.js')

/**
 * Returns the current time as an epoch-based OTel `HrTime` tuple
 * `[seconds, nanoseconds]`.
 *
 * @returns {number[]} now as a hrtime
 */
function nowHrTime() {
  const epochMs = performance.timeOrigin + performance.now()
  const seconds = Math.floor(epochMs / 1_000)
  const nanos = Math.round((epochMs - seconds * 1_000) * 1_000_000)
  return [seconds, nanos]
}

/**
 * Converts a `TimeInput` (epoch ms number, Date, or existing HrTime) to an
 * epoch-based HrTime tuple. Passing `null` or `undefined` returns the current
 * time.
 *
 * @param {number|Date|number[]|null|undefined} input convert to hr time
 * @returns {number[]} a hr time
 */
function toHrTime(input) {
  if (input == null) return nowHrTime()
  if (Array.isArray(input)) return input
  if (input instanceof Date) {
    const ms = input.getTime()
    return [Math.floor(ms / 1_000), Math.round((ms % 1_000) * 1_000_000)]
  }
  // Assume epoch milliseconds
  return [Math.floor(input / 1_000), Math.round((input % 1_000) * 1_000_000)]
}

/**
 * Computes `end - start` as an HrTime duration, handling nanosecond
 * underflow.
 *
 * @param {number[]} start time
 * @param {number[]} end time
 * @returns {number[]} returns hr time diff
 */
function hrTimeDiff(start, end) {
  let seconds = end[0] - start[0]
  let nanos = end[1] - start[1]
  if (nanos < 0) {
    seconds -= 1
    nanos += 1_000_000_000
  }
  return [seconds, nanos]
}

function truncate(value) {
  if (typeof value === 'string' && value.length > ATTR_VALUE_LENGTH_LIMIT) {
    return value.substring(0, ATTR_VALUE_LENGTH_LIMIT)
  }
  return value
}

function truncateLink(link) {
  if (!link.attributes) return link
  const attributes = {}
  for (const [k, v] of Object.entries(link.attributes)) {
    attributes[k] = truncate(v)
  }
  return { ...link, attributes }
}

/**
 * A span implementation owned entirely by the New Relic agent. It satisfies
 * the `@opentelemetry/api` `Span` interface (for user-facing code) and also
 * exposes all readable properties that `NrSpanProcessor` needs.
 *
 * Replaces the `@opentelemetry/sdk-trace-base` `Span` that `BasicTracerProvider`
 * previously created.
 *
 * @see https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api._opentelemetry_api.Span.html
 */
class NrSpan {
  name
  kind
  attributes = {}
  events = []
  links = []
  status = { code: 0 }
  instrumentationScope
  startTime
  duration = [0, 0]
  parentSpanId

  #spanContext
  #processor
  #ended = false

  constructor({
    name,
    kind,
    spanContext,
    parentSpanId,
    startTime,
    attributes,
    links,
    instrumentationScope,
    processor
  }) {
    this.name = name
    this.kind = kind
    this.#spanContext = spanContext
    this.parentSpanId = parentSpanId
    this.startTime = startTime ?? nowHrTime()
    this.instrumentationScope = instrumentationScope ?? { name: '', version: undefined }
    this.#processor = processor

    if (attributes) {
      for (const [k, v] of Object.entries(attributes)) {
        this.attributes[k] = truncate(v)
      }
    }
    if (links) {
      this.links = links.map(truncateLink)
    }
  }

  spanContext() {
    return this.#spanContext
  }

  setAttribute(key, value) {
    this.attributes[key] = truncate(value)
    return this
  }

  setAttributes(attributes) {
    for (const [k, v] of Object.entries(attributes)) {
      this.setAttribute(k, v)
    }
    return this
  }

  addEvent(name, attributesOrStartTime, timeStamp) {
    const attributes = {}
    let time = nowHrTime()

    if (attributesOrStartTime != null) {
      if (isTimeInput(attributesOrStartTime)) {
        time = toHrTime(attributesOrStartTime)
      } else {
        for (const [k, v] of Object.entries(attributesOrStartTime)) {
          attributes[k] = truncate(v)
        }
        if (timeStamp != null) time = toHrTime(timeStamp)
      }
    }

    this.events.push({ name, attributes, time })
    return this
  }

  addLink(link) {
    this.links.push(truncateLink(link))
    return this
  }

  addLinks(links) {
    for (const link of links) {
      this.addLink(link)
    }
    return this
  }

  setStatus({ code, message } = {}) {
    if (code !== undefined) this.status = { code, message }
    return this
  }

  updateName(name) {
    this.name = name
    return this
  }

  end(endTime) {
    if (this.#ended) return
    this.#ended = true
    const end = toHrTime(endTime)
    this.duration = hrTimeDiff(this.startTime, end)
    this.#processor?.onEnd(this)
  }

  isRecording() {
    return !this.#ended
  }

  recordException(exception, time) {
    const attributes = {}
    if (typeof exception === 'string') {
      attributes['exception.message'] = exception
    } else if (exception) {
      if (exception.code) {
        attributes['exception.type'] = exception.code.toString()
      } else if (exception.name) {
        attributes['exception.type'] = exception.name
      }
      if (exception.message) attributes['exception.message'] = exception.message
      if (exception.stack) attributes['exception.stacktrace'] = exception.stack
    }
    if (attributes['exception.type'] || attributes['exception.message']) {
      this.addEvent('exception', attributes, time)
    }
  }
}

module.exports = { NrSpan, nowHrTime, toHrTime }
