/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const { performance } = require('node:perf_hooks')

/**
 * Returns the current time as nanoseconds since the Unix epoch.
 *
 * Anchors the monotonic `performance.now()` clock onto
 * `performance.timeOrigin` (the wall-clock time at process start) rather
 * than using `Date.now()` or `process.hrtime()` directly. This avoids two
 * subtle bugs: `process.hrtime()` is monotonic but not epoch-anchored (it
 * would report times near 1970), and `Date.now()` can jump backward if the
 * system clock is adjusted, which could make a data point's `timeUnixNano`
 * appear to precede its `startTimeUnixNano`.
 *
 * @returns {number} Nanoseconds since the Unix epoch.
 */
function nowUnixNano() {
  return Math.round((performance.timeOrigin + performance.now()) * 1e6)
}

module.exports = { nowUnixNano }
