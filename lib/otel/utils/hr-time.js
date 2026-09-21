/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { performance } = require('node:perf_hooks')

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

/**
 * Converts an OpenTelemetry `HrTime` `[seconds, nanoseconds]` tuple to a
 * duration in milliseconds.
 *
 * @param {number[]} hrTime An `[seconds, nanoseconds]` tuple.
 *
 * @returns {number} Duration in milliseconds.
 */
function hrTimeToMilliseconds(hrTime) {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}

module.exports = {
  nowHrTime,
  toHrTime,
  hrTimeDiff,
  hrTimeToMilliseconds
}
