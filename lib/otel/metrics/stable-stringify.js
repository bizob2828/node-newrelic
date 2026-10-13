/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * Deterministically stringifies a value by sorting object keys, so the
 * same logical attribute set always produces the same string regardless
 * of insertion order. Used to build `Map` keys for grouping measurements
 * and metrics that share the same attributes/instrumentation scope.
 *
 * @param {*} value The value to stringify.
 * @returns {string} The sorted-key JSON string.
 */
function stableStringify(value) {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const keys = Object.keys(value).sort()
  const entries = keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key]))
  return '{' + entries.join(',') + '}'
}

module.exports = { stableStringify }
