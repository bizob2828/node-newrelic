/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * Checks whether `value` is a valid OTel attribute value: `null`/`undefined`,
 * a string/number/boolean primitive, or an array containing only one of
 * those primitive types (plus `null`/`undefined` entries).
 *
 * @param {*} value The value to inspect.
 * @returns {boolean} `true` if the value is valid.
 */
function isAttributeValue(value) {
  if (value == null) {
    return true
  }
  if (Array.isArray(value)) {
    return isHomogeneousArray(value)
  }
  return isValidPrimitiveType(typeof value)
}

function isHomogeneousArray(array) {
  let type
  for (const element of array) {
    if (element == null) continue
    const elementType = typeof element
    if (elementType === type) continue
    if (!type) {
      if (isValidPrimitiveType(elementType)) {
        type = elementType
        continue
      }
      return false
    }
    return false
  }
  return true
}

function isValidPrimitiveType(type) {
  return type === 'number' || type === 'boolean' || type === 'string'
}

/**
 * Drops invalid attribute keys/values, matching
 * `@opentelemetry/core`'s `sanitizeAttributes` semantics: a key must be a
 * non-empty string, and a value must be `null`/`undefined`, a string,
 * number, or boolean, or a homogeneous array of those primitive types.
 * Arrays are copied rather than retained by reference.
 *
 * @param {object} attributes Raw attributes to sanitize.
 * @returns {object} A new object containing only the valid entries.
 */
function sanitizeAttributes(attributes) {
  const out = {}
  if (typeof attributes !== 'object' || attributes == null) {
    return out
  }

  for (const key of Object.keys(attributes)) {
    if (typeof key !== 'string' || key === '') {
      continue
    }
    const value = attributes[key]
    if (!isAttributeValue(value)) {
      continue
    }
    out[key] = Array.isArray(value) ? value.slice() : value
  }

  return out
}

module.exports = { sanitizeAttributes }
