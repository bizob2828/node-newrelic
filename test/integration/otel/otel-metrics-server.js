/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const https = require('node:https')
const fakeCert = require('#testlib/fake-cert.js')
const { getMetricsProtobufTypes } = require('#agentlib/otel/metrics/otlp/otlp-proto-loader.js')

module.exports = async function createOtelMetricsServer(dataTracker) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  const cert = fakeCert()
  const serverOpts = {
    key: cert.privateKeyBuffer,
    cert: cert.certificateBuffer
  }
  const server = https.createServer(serverOpts, requestHandler)

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) return reject(error)
      resolve()
    })
  })

  const { ExportMetricsServiceRequest: requestSchema } = getMetricsProtobufTypes()

  return {
    server,
    host: server.address().address,
    port: server.address().port
  }

  function requestHandler(req, res) {
    dataTracker.path = req.url
    dataTracker.headers = structuredClone(req.headers)

    let payload = Buffer.alloc(0)
    req.on('data', (d) => {
      payload = Buffer.concat([payload, d])
    })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')

      dataTracker.payload = requestSchema.decode(payload)
      server.emit('requestComplete', dataTracker.payload)
    })
  }
}
