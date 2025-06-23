/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const urltils = require('../util/urltils')

/**
 * Default value for unknown instance parameters.
 *
 * @readonly
 * @private
 */
const INSTANCE_UNKNOWN = 'unknown'

/**
 * Normalizes segment parameter values.
 *
 * - `_normalizeParameters([parameters])`
 *
 * Removes disabled parameters and corrects other values, such as changing host
 * from `localhost` to the actual host name.
 *
 * @param {object} [parameters] - The segment parameters to clean up.
 * @param config
 * @param datastore
 * @returns {object} - The normalized segment parameters.
 */
function normalizeParameters(parameters, config, datastore) {
  parameters = parameters || Object.create(null)
  // const config = this.agent.config
  const dsTracerConf = config.datastore_tracer

  parameters.product = parameters.product || datastore

  _normalizeDatabaseName(parameters, dsTracerConf)
  _normalizeInstanceInformation(parameters, dsTracerConf, config)

  return parameters
}

/**
 * Normalizes the database name from segment parameter values.
 *
 * @private
 * @param {object} parameters   - The segment parameters to clean up.
 * @param {object} dsTracerConf - The datastore tracer configuration
 */
function _normalizeDatabaseName(parameters, dsTracerConf) {
  // Add database name if provided and enabled.
  if (!dsTracerConf.database_name_reporting.enabled) {
    delete parameters.database_name
  } else if (parameters.database_name !== false) {
    parameters.database_name =
      typeof parameters.database_name === 'number'
        ? String(parameters.database_name)
        : parameters.database_name || INSTANCE_UNKNOWN
  }
}

/**
 * Normalizes the database instance information from segment parameter
 * values: host and the port/path/id.
 *
 * @private
 * @param {object} parameters   - The segment parameters to clean up.
 * @param {object} dsTracerConf - The datastore tracer configuration
 * @param {object} config       - The agent configuration
 */
function _normalizeInstanceInformation(parameters, dsTracerConf, config) {
  // Add instance information if enabled.
  if (!dsTracerConf.instance_reporting.enabled) {
    delete parameters.host
    delete parameters.port_path_or_id
  } else {
    // Determine appropriate defaults for host and port.
    if (parameters.port_path_or_id !== false) {
      parameters.port_path_or_id = String(parameters.port_path_or_id || INSTANCE_UNKNOWN)
    }
    if (parameters.host) {
      if (parameters.host && urltils.isLocalhost(parameters.host)) {
        parameters.host = config.getHostnameSafe(parameters.host)
      }

      // Config's default name of a host is `UNKNOWN_BOX`.
      if (!parameters.host || parameters.host === 'UNKNOWN_BOX') {
        parameters.host = INSTANCE_UNKNOWN
      }
    }
  }
}

module.exports = normalizeParameters
