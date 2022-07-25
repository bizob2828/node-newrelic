/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const helper = require('../../lib/agent_helper')
const metrics = require('../../lib/metrics_helper')
const { DESTINATIONS } = require('../../../lib/config/attribute-filter')
const tap = require('tap')
const http = require('http')
const https = require('https')
const semver = require('semver')

tap.test('fetch', { skip: semver.lte(process.version, '18.0.0') }, function (t) {
  t.autoend()

  let agent = null
  t.beforeEach(() => {
    agent = helper.instrumentMockedAgent({
      feature_flag: {
        instrument_global_fetch: true
      }
    })
  })

  t.afterEach(() => {
    helper.unloadAgent(agent)
  })

  t.test('should not fail if request not in a transaction', async (t) => {
    const { status } = await fetch('https://httpbin.org/post', {
      method: 'POST',
      headers: {
        'Content-Type': 'application.json'
      },
      body: Buffer.from(`{"key":"value"}`)
    })

    t.equal(status, 200)
    t.end()
  })

  t.test('should properly name segments', (t) => {
    helper.runInTransaction(agent, async (tx) => {
      const { status } = await fetch('https://httpbin.org/post', {
        method: 'POST',
        headers: {
          'Content-Type': 'application.json'
        },
        body: Buffer.from(`{"key":"value"}`)
      })
      t.equal(status, 200)

      metrics.assertSegments(tx.trace.root, ['External/httpbin.org/post'], { exact: false })
      tx.end()
      t.end()
    })
  })

  t.test('should add HTTP port to segment name when provided', (t) => {
    const server = http.createServer((req, res) => {
      req.resume()
      res.end('http')
    })

    t.teardown(() => {
      server.close()
    })

    server.listen(0)

    helper.runInTransaction(agent, async (transaction) => {
      const { port } = server.address()
      await fetch(`http://localhost:${port}`)

      metrics.assertSegments(transaction.trace.root, [`External/localhost:${port}/`], {
        exact: false
      })

      transaction.end()
      t.end()
    })
  })

  t.test('should add HTTPS port to segment name when provided', async (t) => {
    const [key, cert, ca] = await helper.withSSL()
    const server = https.createServer({ key, cert }, (req, res) => {
      res.write('SSL response')
      res.end()
    })

    t.teardown(() => {
      server.close()
    })

    server.listen(0)

    await helper.runInTransaction(agent, async (transaction) => {
      const { port } = server.address()

      await fetch(`https://localhost:${port}/`, {
        tls: {
          ca
        }
      })

      metrics.assertSegments(transaction.trace.root, [`External/localhost:${port}/`], {
        exact: false
      })

      transaction.end()
    })
  })

  t.test('should add attributes to external segment', (t) => {
    helper.runInTransaction(agent, async (tx) => {
      const { status } = await fetch('https://httpbin.org/get?a=b&c=d')
      t.equal(status, 200)
      const segment = metrics.findSegment(tx.trace.root, 'External/httpbin.org/get')
      const attrs = segment.getAttributes()
      t.equal(attrs.url, 'https://httpbin.org/get')
      t.equal(attrs.procedure, 'GET')
      const spanAttrs = segment.attributes.get(DESTINATIONS.SPAN_EVENT)
      t.equal(spanAttrs['http.statusCode'], 200)
      t.equal(spanAttrs['http.statusText'], 'OK')
      t.equal(spanAttrs['request.parameters.a'], 'b')
      t.equal(spanAttrs['request.parameters.c'], 'd')

      tx.end()
      t.end()
    })
  })

  t.test('invalid host', (t) => {
    helper.runInTransaction(agent, async (tx) => {
      try {
        await fetch('https://invalidurl/foo')
      } catch (err) {
        t.equal(err.message, 'fetch failed')
        const segment = metrics.findSegment(tx.trace.root, 'External/invalidurl/foo')
        t.notOk(segment)
        tx.end()
        t.end()
      }
    })
  })

  t.test('should add errors to transaction when external segment exists', (t) => {
    const abortController = new AbortController()
    helper.runInTransaction(agent, async (tx) => {
      try {
        const req = fetch('https://httpbin.org/delay/1', {
          signal: abortController.signal
        })
        setTimeout(() => {
          abortController.abort()
        }, 100)
        await req
      } catch (err) {
        metrics.assertSegments(tx.trace.root, ['External/httpbin.org/delay/1'], { exact: false })
        t.equal(tx.exceptions.length, 1)
        t.equal(tx.exceptions[0].error.message, 'Request aborted')
        tx.end()
        t.end()
      }
    })
  })

  t.test('segments should end on error', (t) => {
    const socketEndServer = http.createServer(function badHandler(req) {
      req.socket.end()
    })

    t.teardown(() => {
      socketEndServer.close()
    })

    socketEndServer.listen(0)

    helper.runInTransaction(agent, async (transaction) => {
      const { port } = socketEndServer.address()
      const req = fetch(`http://localhost:${port}`)

      try {
        await req
      } catch (error) {
        metrics.assertSegments(transaction.trace.root, [`External/localhost:${port}/`], {
          exact: false
        })

        const segments = transaction.trace.root.children
        const segment = segments[segments.length - 1]

        t.ok(segment.timer.start, 'should have started')
        t.ok(segment.timer.hasEnd(), 'should have ended')

        transaction.end()

        t.end()
      }
    })
  })

  t.test('400 status', (t) => {
    helper.runInTransaction(agent, async (tx) => {
      const { status } = await fetch('https://httpbin.org/status/400')
      t.equal(status, 400)
      metrics.assertSegments(tx.trace.root, ['External/httpbin.org/status/400'], { exact: false })
      tx.end()
      t.end()
    })
  })
})
