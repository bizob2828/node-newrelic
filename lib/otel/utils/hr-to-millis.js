/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * Converts an OpenTelemetry `HrTime` `[seconds, nanoseconds]` tuple to a
 * duration in milliseconds.
 *
 * @param {number[]} hrTime An `[seconds, nanoseconds]` tuple.
 *
 * @returns {number} Duration in milliseconds.
 */
module.exports = function hrTimeToMilliseconds(hrTime) {
  return hrTime[0] * 1000 + hrTime[1] / 1e6
}
