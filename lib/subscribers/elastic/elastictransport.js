/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const Subscriber = require('../base')
const { ALL, DB } = require('../../metrics/names')
const { handlerElastic } = require('./handlers')

const DATASTORE = 'ElasticSearch'

class ElasticTransportSubscriber extends Subscriber {
  constructor(agent) {
    super(agent, '@elastic/transport:nr_request')
    this.events = ['end']
    this._metrics = {
      PREFIX: DATASTORE,
      STATEMENT: `${DB.STATEMENT}/${DATASTORE}/`,
      ALL: `${DB.PREFIX}${DATASTORE}/${ALL}`
    }
  }

  handler(data) {
    handlerElastic.call(this, data)
  }
}

module.exports = ElasticTransportSubscriber
