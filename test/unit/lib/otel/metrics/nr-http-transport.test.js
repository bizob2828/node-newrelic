/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const NrHttpTransport = require('#agentlib/otel/metrics/nr-http-transport.js')

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function urlFor(server) {
  const { port } = server.address()
  return `http://127.0.0.1:${port}/`
}

test.afterEach((ctx) => {
  if (ctx.nr?.server) {
    ctx.nr.server.close()
  }
})

test('resolves with the response body on success', async (t) => {
  t.nr = {}
  t.nr.server = await startServer((req, res) => {
    res.writeHead(200)
    res.end('ok')
  })

  const transport = new NrHttpTransport({ url: urlFor(t.nr.server) })
  const result = await transport.send(Buffer.from('payload'))
  assert.equal(result.toString(), 'ok')
})

test('fails immediately on a non-retryable status', async (t) => {
  t.nr = {}
  t.nr.server = await startServer((req, res) => {
    res.writeHead(400)
    res.end('bad request')
  })

  const transport = new NrHttpTransport({ url: urlFor(t.nr.server) })
  await assert.rejects(
    () => transport.send(Buffer.from('payload')),
    /OTLP export failed with status 400/
  )
})

test('retries a retryable status until it succeeds', async (t) => {
  t.nr = {}
  let attempts = 0
  t.nr.server = await startServer((req, res) => {
    attempts += 1
    if (attempts < 3) {
      res.writeHead(503, { 'retry-after': '0' })
      res.end()
      return
    }
    res.writeHead(200)
    res.end('ok')
  })

  const transport = new NrHttpTransport({ url: urlFor(t.nr.server) })
  const result = await transport.send(Buffer.from('payload'))
  assert.equal(result.toString(), 'ok')
  assert.equal(attempts, 3)
})

test('gives up once the retry deadline elapses', async (t) => {
  t.nr = {}
  let attempts = 0
  t.nr.server = await startServer((req, res) => {
    attempts += 1
    res.writeHead(503)
    res.end()
  })

  const transport = new NrHttpTransport({ url: urlFor(t.nr.server), timeoutMillis: 50 })
  await assert.rejects(() => transport.send(Buffer.from('payload')))
  assert.equal(attempts, 1, 'should not retry once the backoff would exceed the deadline')
})

test('treats a request timeout as retryable', async (t) => {
  t.nr = {}
  t.nr.server = await startServer(() => {
    // Never respond, forcing the client-side timeout to fire.
  })

  const transport = new NrHttpTransport({ url: urlFor(t.nr.server), timeoutMillis: 50 })
  await assert.rejects(() => transport.send(Buffer.from('payload')), /timed out/)
})

test('sends the configured headers and body', async (t) => {
  t.nr = {}
  let receivedHeaders = null
  let receivedBody = null
  t.nr.server = await startServer((req, res) => {
    receivedHeaders = req.headers
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks)
      res.writeHead(200)
      res.end()
    })
  })

  const transport = new NrHttpTransport({
    url: urlFor(t.nr.server),
    headers: { 'api-key': 'abc123', 'content-type': 'application/x-protobuf' }
  })
  await transport.send(Buffer.from('hello'))

  assert.equal(receivedHeaders['api-key'], 'abc123')
  assert.equal(receivedHeaders['content-type'], 'application/x-protobuf')
  assert.equal(receivedBody.toString(), 'hello')
})
