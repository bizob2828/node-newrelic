/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const testCases = require('../../lib/otel-bridge-cross-agent-tests/TestCaseDefinitions.json')
const cmds = require('#testlib/otel-bridge-cross-agent-tests/commands.js')
const testAssertions = require('#testlib/otel-bridge-cross-agent-tests/assertions.js')
const test = require('node:test')
const helper = require('#testlib/agent_helper.js')
const camelCase = require('#agentlib/util/camel-case.js')
const otel = require('@opentelemetry/api')

test.beforeEach((ctx) => {
  ctx.nr = {}
  ctx.nr.agent = helper.instrumentMockedAgent({ feature_flag: { opentelemetry_bridge: true } })
  ctx.nr.api = helper.getAgentApi(ctx.nr.agent)
  ctx.nr.tracer = otel.trace.getTracer('cross-agent-tests')
})

test.afterEach((ctx) => {
  helper.unloadAgent(ctx.nr.agent)
})

async function parseOperation({ agent, api, tracer, operation }) {
  const cmd = camelCase(operation.command)
  console.log('running cmd', cmd)
  if (operation.childOperations) {
    await cmds[cmd]({ agent, api, tracer, ...operation.parameters }, async (data) => {
      for (const childOp of operation.childOperations) {
        await parseOperation({ agent, api, tracer, operation: childOp })
        data?.end()
        console.log('ENDING CHILD OP', data?.name)
      }
    })
  } else {
    await new Promise((resolve) => {
      cmds[cmd]({ agent, api, tracer, ...operation.parameters }, async (data) => {
        if (operation.assertions) {
          operation.assertions.forEach((assertion) => {
            const method = camelCase(assertion.rule.operator)
            testAssertions[method](agent, assertion.rule.parameters, assertion.description)
          })
        }

        data?.end()
        console.log('ENDING ROOT CALL', data?.name)
        resolve()
      })
    })
  }
}

testCases.forEach((testCase) => {
  test(testCase.testDescription, async (t) => {
    console.log('running test case', testCase.testDescription)
    const { agent, api, tracer } = t.nr
    for (const operation of testCase.operations) {
      await parseOperation({ agent, api, tracer, operation })
    }

    testAssertions.agentOutput(agent, testCase.agentOutput)
  })
})
