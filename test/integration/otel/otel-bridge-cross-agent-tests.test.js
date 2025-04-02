/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
//const testCases = require('../../lib/otel-bridge-cross-agent-tests/TestCaseDefinitions.json')
const testCases = require('../../lib/otel-bridge-cross-agent-tests/test.json')
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



const tests = []
function parseOperation(operation) {
  for (const childOp of operation.childOperations || []) {
    if (childOp.assertions) {
      tests.push({ command: childOp.command, parameters: childOp.parameters, assertions: childOp.assertions })
    } else {
      tests.push({ command: childOp.command, parameters: childOp.parameters, assertions: [] })
    }
    parseOperation(childOp)
  }
}

let root = {}
const actions = []

testCases.forEach((testCase) => {
  test(testCase.testDescription, async (t) => {
    const { agent, api, tracer } = t.nr
    console.log('-----------------------')
    console.log('RUNNING TEST', testCase.testDescription)
    for (const operation of testCase.operations) {
      root.command = operation.command
      root.parameters = operation.parameters
      root.assertions = operation.assertions ?? []
      parseOperation(operation)
    }

    runOperation({ agent, api, tracer, operation: root }, async (data) => {
      actions.push(data)
      for (const operation of tests) {
        const result = await new Promise((resolve) => {
          runOperation({ agent, api, tracer, operation, data: actions[actions.length - 1]}, resolve) 
        })

        if (result) {
          actions.push(result)
        }
      }
      

      actions.forEach((result) => {
        result.end()
      })

      console.log('RUNNING AGENT OUTPUT')
      testAssertions.agentOutput(agent, testCase.agentOutput)
    })
  })
})

async function runOperation({ agent, api, tracer, operation, data }, cb) {
  if (operation.command) {
    const { command, parameters } = operation
    const cmd = camelCase(command)
    console.log('RUNNING COMMAND', cmd)
    cmds[cmd]({ agent, api, tracer, data, ...parameters }, (data) => {
      operation.assertions.forEach((assertion) => {
        const method = camelCase(assertion.rule.operator)
        console.log('RUNNING ASSERTION', method, assertion.description)
        debugger
        testAssertions[method](agent, assertion.rule.parameters, assertion.description)
      })

      cb(data)
    })
  }
}
