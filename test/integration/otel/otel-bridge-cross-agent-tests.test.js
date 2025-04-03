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



function parseOperation(operation, tests, node, parent = 0, nest) {
  debugger

  const childOps = operation.childOperations ?? []
  childOps.forEach((childOp, index) => {
    if (!nest) {
      parent = index
    } 

    if (!tests.operations[node].nodes[parent]) {
      tests.operations[node].nodes[parent] = []
    }
      
    tests.operations[node].nodes[parent].push({ command: childOp.command, parameters: childOp.parameters, assertions: childOp?.assertions ?? [] })
    
    parseOperation(childOp, tests, node, parent, true)
  })
    
}


testCases.forEach((testCase) => {
  test(testCase.testDescription, async (t) => {
    let root = {}
    const actions = []
    const tests = { operations: []}
    const { agent, api, tracer } = t.nr
    console.log('-----------------------')
    console.log('RUNNING TEST', testCase.testDescription)
    testCase.operations.forEach((operation, index) => {

      tests.operations.push({ root: { command: operation.command, parameters: operation.parameters, assertions: operation.assertions ?? [] }, nodes: [] })
      parseOperation(operation, tests, index)
    })

    debugger
    runOperation({ agent, api, tracer, operation: root }, async (data) => {
      actions.push(data)
      for (const operation of tests) {
        runOperation({ agent, api, tracer, operation, data: actions[actions.length - 1]}, resolve) 
      }
      

      actions.forEach((result) => {
        debugger
        result.end()
      })

      console.log('RUNNING AGENT OUTPUT')
      testAssertions.agentOutput(agent, testCase.agentOutput)
    })
  })
})

/*
async function runOperation({ agent, api, tracer, operation, data }, cb) {
  if (operation.command) {
    const { command, parameters } = operation
    const cmd = camelCase(command)
    console.log('RUNNING COMMAND', cmd)
    const ctx = agent.getTracer.getContext()
    console.log('before run', ctx?.segment?.name)
    cmds[cmd]({ agent, api, tracer, data, ...parameters }, (data) => {
      const ctx = agent.tracer.getContext()
      conosle.log('during run', ctx?.segment?.name)
      debugger
      operation.assertions.forEach((assertion) => {
        const method = camelCase(assertion.rule.operator)
        console.log('RUNNING ASSERTION', method, assertion.description)
        debugger
        testAssertions[method](agent, assertion.rule.parameters, assertion.description)
      })

      actions.unshift(data)
      cb(data)
    })
  }
}
*/
