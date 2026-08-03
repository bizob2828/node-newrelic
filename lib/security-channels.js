/*
 * Copyright 2024 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

/**
 * Shared diagnostics_channel registry for security-agent event integration.
 *
 * node-newrelic publishes to these channels at each instrumented hook point.
 * The security agent (csec-node-agent) subscribes to receive raw values for
 * IAST/RASP analysis without needing duplicate instrumentation.
 *
 * Every publish site is gated on `channel.hasSubscribers` so there is zero
 * overhead when no security agent is loaded.
 *
 * Channel naming convention: newrelic:<module>:<operation>:<phase>
 */

const dc = require('node:diagnostics_channel')

module.exports = {
  // Transaction lifecycle
  transactionStart: dc.channel('newrelic:transaction:start'),
  transactionFinish: dc.channel('newrelic:transaction:finish'),

  // Inbound HTTP (taint sources)
  httpInboundStart: dc.channel('newrelic:http:inbound:start'),
  httpInboundBody: dc.channel('newrelic:http:inbound:body'),
  httpInboundFinish: dc.channel('newrelic:http:inbound:finish'),

  // Outbound HTTP (SSRF)
  httpOutboundStart: dc.channel('newrelic:http:outbound:start'),
  httpOutboundFinish: dc.channel('newrelic:http:outbound:finish'),

  // SQL (injection)
  sqlQueryStart: dc.channel('newrelic:sql:query:start'),
  sqlQueryFinish: dc.channel('newrelic:sql:query:finish'),

  // NoSQL (injection)
  nosqlOperationStart: dc.channel('newrelic:nosql:operation:start'),
  nosqlOperationFinish: dc.channel('newrelic:nosql:operation:finish'),

  // File system (path traversal / file integrity)
  fsReadStart: dc.channel('newrelic:fs:read:start'),
  fsWriteStart: dc.channel('newrelic:fs:write:start'),

  // Child process (command injection)
  childProcessStart: dc.channel('newrelic:child_process:start'),
  childProcessFinish: dc.channel('newrelic:child_process:finish'),

  // Cryptography (weak algorithms)
  cryptoHashStart: dc.channel('newrelic:crypto:hash:start'),
  cryptoCipherStart: dc.channel('newrelic:crypto:cipher:start'),
  cryptoRandom: dc.channel('newrelic:crypto:random'),

  // VM / code injection
  vmExecutionStart: dc.channel('newrelic:vm:execution:start'),

  // LDAP injection
  ldapSearchStart: dc.channel('newrelic:ldap:search:start'),

  // XPath injection
  xpathEvaluateStart: dc.channel('newrelic:xpath:evaluate:start'),

  // GraphQL
  graphqlResolveStart: dc.channel('newrelic:graphql:resolve:start'),

  // Template rendering
  templateRenderStart: dc.channel('newrelic:template:render:start'),
}
