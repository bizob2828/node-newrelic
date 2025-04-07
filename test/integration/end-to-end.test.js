/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const test = require('node:test')
const nock = require('nock')
const { nockRequest } = require('./response-handling-utils')
const path = require('path')
const grpc = require('@grpc/grpc-js')
const protoLoader = require('@grpc/proto-loader')
const { INFINITE_TRACING } = require('#agentlib/metrics/names.js')

const fakeCert = require('../lib/fake-cert')
const helper = require('../lib/agent_helper')
const { tspl } = require('@matteo.collina/tspl')

// We generate the certificate once for the whole suite because it is a CPU
// intensive operation and would slow down tests if each test created its
// own certificate.
const cert = fakeCert({ commonName: 'localhost' })
const PROTO_PATH = path.join(__dirname, '../..', '/lib/grpc/endpoints/infinite-tracing/v1.proto')
const TEST_DOMAIN = 'test-collector.newrelic.com'
// This key is hardcoded in the agent helper
const EXPECTED_LICENSE_KEY = 'license key here'
const INITIAL_RUN_ID = 'initial_run_id'
const INITIAL_SESSION_ID = 'initial_session_id'

const EXPECTED_SEGMENT_NAME = 'Test Segment'
const EXPECTED_SEGMENT_NAME_2 = 'Test Segment 2'

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
})

function assertBatch({ spans, names, plan }) {
  plan.ok(spans.length === names.length, `should have ${names.length}`)

  spans.forEach((span, i) => {
    const { name } = span.intrinsics
    plan.equal(name.string_value, names[i])
  })
}

function assertSpan({ span, i, names, plan }) {
  plan.ok(span)

  const { name } = span.intrinsics
  plan.equal(name.string_value, names[i]) 
}

const infiniteTracingService = grpc.loadPackageDefinition(packageDefinition).com.newrelic.trace.v1

// This runs through the same tests with the following 4 scenarios:
//  1. batching and compression
//  2. batching and no compression
//  3. no batching and compression
//  4. no batching and no compression
//
//  Depending on the mode it asserts the spans in 1 batch of in different stream.write
;[
  {
    batching: true,
    compression: true
  },
].forEach((config) => {
  test(`Infinite tracing - Batching Connection Handling ${JSON.stringify(config)}`, async (t) => {
    t.beforeEach(async (ctx) => {
      ctx.nr = {}
      // Currently test-only configuration
      ctx.nr.origEnv = process.env.NEWRELIC_GRPCCONNECTION_CA
      process.env.NEWRELIC_GRPCCONNECTION_CA = cert.certificate
      await testSetup(ctx, config)
    })

    t.afterEach(async (ctx) => {
      const { agent, origEnv, server } = ctx.nr
      process.env.NEWRELIC_GRPCCONNECTION_CA = origEnv
      helper.unloadAgent(agent)

      if (!nock.isDone()) {
        console.error('Cleaning pending mocks: %j', nock.pendingMocks())
        nock.cleanAll()
      }

      nock.enableNetConnect()

      await new Promise((resolve) => {
        server.tryShutdown(resolve)
      })
    })

    /*
    await t.test('should successfully send span after startup', async (t) => {
      const plan = tspl(t, { plan: 12 })
      const { agent, startingEndpoints } = t.nr
      const expectedRunId = INITIAL_RUN_ID
      const expectedSessionId = INITIAL_SESSION_ID
      const names = [EXPECTED_SEGMENT_NAME, EXPECTED_SEGMENT_NAME_2]
      t.nr.spanReceivedListener = defaultSpanListener({
        names,
        agent,
        config,
        expectedRunId,
        expectedSessionId,
        plan,
        dropped: 0,
        sent: 2,
        seen: 2
      })

      agent.start((error) => {
        verifyAgentStart({ error, endpoints: startingEndpoints, plan })

        createTestData({ agent, names })
      })

      await plan.completed
    })

    await t.test('should handle server errors', async (t) => {
      const plan = tspl(t, { plan: 14 })
      const { agent, startingEndpoints } = t.nr
      const expectedRunId = INITIAL_RUN_ID
      const expectedSessionId = INITIAL_SESSION_ID
      const names = [EXPECTED_SEGMENT_NAME, EXPECTED_SEGMENT_NAME_2, 'testSegment']
      const batch2 = ['testSegment2']
      t.nr.spanReceivedListener = defaultSpanListener({
        names: [...names, ...batch2],
        agent,
        config,
        expectedRunId,
        expectedSessionId,
        plan,
        dropped: 0,
        sent: 4,
        seen: 4 
      })

      agent.start((error) => {
        verifyAgentStart({ error, endpoints: startingEndpoints, plan })

        createTestData({ agent, names }) 
        // delay sending more spans until the connection re-establishes
        setTimeout(() => {
          createTestData({ agent, names: batch2 }) 
        }, 7000)
      })

      await plan.completed
    })
    */
    
    await t.test('should only send queue size of spans on first attempt', async (t) => {
      const plan = tspl(t, { plan: 28 })
      const { agent, startingEndpoints } = t.nr
      agent.infinite_tracing
      const expectedRunId = INITIAL_RUN_ID
      const expectedSessionId = INITIAL_SESSION_ID
      const names = [EXPECTED_SEGMENT_NAME, EXPECTED_SEGMENT_NAME_2, 'testSegment', 'testSegment2', 'testSegment3', 'testSegment4', 'testSegment5', 'testSegment6', 'testSegment7', 'testSegment8']
      const batch2 = ['testSegment9']
      t.nr.spanReceivedListener = defaultSpanListener({
        calls: [
          { 
            sent: 10,
            seen: 12,
            dropped: 0,
            names
          },
          {
            sent: 11,
            seen: 11,
            dropped: 0,
            names: batch2
          }
        ],
        agent,
        config,
        expectedRunId,
        expectedSessionId,
        plan,
      })

      agent.start((error) => {
        verifyAgentStart({ error, endpoints: startingEndpoints, plan })

        createTestData({ agent, names: [...names, ...batch2] })
        setTimeout(() => {
          createTestData({ agent, names: ['bobTest']})
        }, 7000)
      })

      await plan.completed
    })
  })
  
})

function defaultSpanListener({ agent, config, expectedRunId, expectedSessionId, plan, calls }) {
  let i = 0

  return function onSpans(data, metadata) {
    console.log('spans received', data.length)
    const call = calls[i]
    const { names, seen, sent, dropped } = call
    console.log(names, seen, sent, dropped)
    i++
    if (config.batching) {
      assertBatch({ spans: data, names, plan })
    } else {
      assertSpan({ span, i, names: call.names, plan })
    }

    const [licenseKey] = metadata.get('license_key')
    plan.equal(licenseKey, EXPECTED_LICENSE_KEY, 'expected license key')

    const [runId] = metadata.get('agent_run_token')
    plan.equal(runId, expectedRunId, 'agent_run_token matches')

    const [sessionId] = metadata.get('session_id')
    plan.equal(sessionId, expectedSessionId, 'should persist new request_headers_map on metadata')

    if (config.batching || i === names.length) { 
      const actualSeen = agent.metrics.getOrCreateMetric(INFINITE_TRACING.SEEN).callCount
      const actualSent = agent.metrics.getOrCreateMetric(INFINITE_TRACING.SENT).callCount
      const actualDropped = agent.metrics.getOrCreateMetric(INFINITE_TRACING.DROPPED).callCount
      console.log(actualSeen, actualSent, actualDropped)
      plan.equal(actualSeen, seen, `should have seen ${seen} spans`)
      plan.equal(actualSent, data, `should have sent ${sent} spans`)
      plan.equal(actualDropped, dropped, `should have dropped ${dropped} spans`)
    }
  }
}

function recordSpan(ctx, stream) {
  const { spanReceivedListener } = ctx.nr
  stream.on('data', function (span) {
    if (spanReceivedListener) {
      spanReceivedListener(span, stream.metadata)
    }
  })

  // this is necessary to properly end calls and cleanup
  stream.on('end', () => {
    stream.end()
  })
}

function recordSpanBatch(ctx, stream) {
  const { spanReceivedListener } = ctx.nr
  stream.on('data', function ({ spans }) {
    console.log('got spans', spans.length)
    if (spans.length === 3) {
      stream.emit('error', { code: 13, message: 'bob test' })
      return
    }

    if (spanReceivedListener) {
      console.log('called span recieved listener')
      spanReceivedListener(spans, stream.metadata)
    }
  })

  stream.on('error', (err) => {
    console.log('error', err)
  })
  // this is necessary to properly end calls and cleanup
  stream.on('end', () => {
    console.log('stream is ended')
    stream.end()
  })
}

async function testSetup(ctx, config) {
  nock.disableNetConnect()
  ctx.nr.startingEndpoints = setupConnectionEndpoints(INITIAL_RUN_ID, INITIAL_SESSION_ID)

  const sslOpts = {
    ca: cert.certificateBuffer,
    authPairs: [{ private_key: cert.privateKeyBuffer, cert_chain: cert.certificateBuffer }]
  }

  const services = [
    {
      serviceDefinition: infiniteTracingService.IngestService.service,
      implementation: {
        recordSpan: recordSpan.bind(null, ctx),
        recordSpanBatch: recordSpanBatch.bind(null, ctx)
      }
    }
  ]

  const { port, server } = await createGrpcServer(sslOpts, services)
  ctx.nr.agent = helper.loadMockedAgent({
    license_key: EXPECTED_LICENSE_KEY,
    apdex_t: Number.MIN_VALUE, // force transaction traces
    host: TEST_DOMAIN,
    plugins: {
      // turn off native metrics to avoid unwanted gc metrics
      native_metrics: { enabled: false }
    },
    distributed_tracing: { enabled: true },
    slow_sql: { enabled: true },
    transaction_tracer: {
      record_sql: 'obfuscated',
      explain_threshold: Number.MIN_VALUE // force SQL traces
    },
    utilization: {
      detect_aws: false
    },
    infinite_tracing: {
      ...config,
      span_events: {
        queue_size: 10
      },
      trace_observer: {
        host: helper.SSL_HOST,
        port
      }
    }
  })

  ctx.nr.agent.config.no_immediate_harvest = true
  ctx.nr.server = server
}

function createTestData({ agent, names }) {
  helper.runInTransaction(agent, (transaction) => {
    names.forEach((name) => {
      const segment = transaction.trace.add(name)
      segment.overwriteDurationInMillis(1)
    })

    transaction.finalizeNameFromUri('/some/test/url', 200)
    transaction.end()
  })
}

function setupConnectionEndpoints(runId, sessionId) {
  return {
    preconnect: nockRequest('preconnect').reply(200, { return_value: TEST_DOMAIN }),
    connect: nockRequest('connect').reply(200, {
      return_value: {
        agent_run_id: runId,
        request_headers_map: {
          SESSION_ID: sessionId
        }
      }
    }),
    settings: nockRequest('agent_settings', runId).reply(200, { return_value: [] })
  }
}

function verifyAgentStart({ error, endpoints, plan }) {
  debugger
  if (error) {
    throw error
  }

  plan.ok(endpoints.preconnect.isDone(), 'requested preconnect')
  plan.ok(endpoints.connect.isDone(), 'requested connect')
  plan.ok(endpoints.settings.isDone(), 'requested settings')
}

/**
 * Creates a grpc server and returns once bound to a port.
 *
 * Does not start the server.
 *
 * @param {object} [sslOptions]
 * @param {Buffer | null} [sslOptions.ca]
 * @param {Array<{private_key: Buffer, cert_chain: Buffer}>} [sslOptions.authPairs]
 * @param {Array<{serviceDefinition: ServiceDefinition, implementation: object}>} services
 */
async function createGrpcServer(sslOptions, services) {
  const server = new grpc.Server()
  for (const [, service] of services.entries()) {
    server.addService(service.serviceDefinition, service.implementation)
  }

  const { authPairs } = sslOptions
  const credentials = grpc.ServerCredentials.createSsl(null, authPairs, false)

  return new Promise((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', credentials, (err, port) => {
      if (err) {
        reject(err)
      }

      resolve({ port, server })
    })
  })
}
