/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * Builds a resource object carrying a sanitized attributes map (drops
 * `null`/`undefined` values). `.attributes` is the only member this
 * bridge's reader/transformer ever read, so a plain object is all that's
 * needed here -- no class required.
 *
 * @param {object} [attributes] Resource attributes.
 * @returns {object} `{ attributes }`.
 */
function resourceFromAttributes(attributes = {}) {
  const sanitized = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) {
      sanitized[key] = value
    }
  }
  return { attributes: sanitized }
}

module.exports = { resourceFromAttributes }
