/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const specs = require('../shim/specs')
const { DatastoreParameters } = specs.params
const normalizeParameters = require('./normalize-db-parameters')

/**
 * Normalizes and adds datastore instance attributes to the current segment.
 *
 * If the current segment was not created by this shim then no action is taken.
 *
 * @param {string}        host      - The name of the database host.
 * @param {number|string} port      - The port, path, or ID of the database server.
 * @param {string}        database  - The name of the database.
 * @param segment
 * @param {string}        datastore
 * @param {object}        config
 */
function captureInstanceAttributes({ host, port, database, segment, datastore, config }) {
  // Normalize the instance attributes.
  const attributes = normalizeParameters(
    new DatastoreParameters({
      host,
      port_path_or_id: port,
      database_name: database
    }),
    config,
    datastore
  )

  for (const key in attributes) {
    if (attributes[key]) {
      segment.addAttribute(key, attributes[key])
    }
  }
}

module.exports = {
  captureInstanceAttributes
}
