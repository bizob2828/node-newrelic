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
  ctx.nr.agent = helper.instrumentMockedAgent({ feature_flag: { opentelemetry_bridge: true }})
  ctx.nr.api = helper.getAgentApi(ctx.nr.agent)
  ctx.nr.tracer = otel.trace.getTracer('cross-agent-tests')
})

test.afterEach((ctx) => {
  helper.unloadAgent(ctx.nr.agent)
})

testCases.forEach((testCase) => {
  test(testCase.testDescription, async (t) => {
    const { agent, api, tracer } = t.nr

    await new Promise((resolve) => {
      for (const operation of testCase.operations) {
        const cmd = camelCase(operation.command)
        cmds[cmd]({ agent, api, tracer, ...operation.parameters}, async (data) => {
          if (operation.childOperations) {
            for (const childOp of operation.childOperations) {
              const childCmd = camelCase(childOp.command)
              await new Promise((innerResolve) => {
                cmds[childCmd]({ agent, api, tracer, ...childOp.parameters}, async (childData) => {
                  if (childOp.childOperations) {
                    for (const cOp of childOp.childOperations) {
                      const cCmd = camelCase(cOp.command)
                      await new Promise((cResolve) => {
                        cmds[cCmd]({ agent, api, tracer, ...cOp.parameters}, (cData) => {
                          cOp.assertions.forEach((cAss) => {
                            const cAssert = camelCase(cAss.rule.operator)
                            testAssertions[cAssert](agent, cAss.rule.parameters, cAss.description)
                          })

                          cData.end()
                          cResolve()
                        })
                      })

                    }
                  }

                  if (childOp.assertions) {
                    childOp.assertions.forEach((childA) => {
                      const childAssertion = camelCase(childA.rule.operator)
                      testAssertions[childAssertion](agent, childA.rule.parameters, childA.description)
                    })
                  }

                  childData.end()
                  innerResolve()
                })
              })
            }
          }
          
          if (operation.assertions) {
            operation.assertions.forEach((a) => {
              const assertion = camelCase(a.rule.operator)
              testAssertions[assertion](agent, a.rule.parameters, a.description)
            })
          }

          data.end()
          resolve()
        })
      }
    })
        
    testAssertions.agentOutput(agent, testCase.agentOutput)
  })
})



