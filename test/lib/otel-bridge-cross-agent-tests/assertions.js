/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const assert = require('node:assert')
const parameters = require('./parameters')

function notValid(agent, param, description) {
  const fn = parameters[param.object]
  const result = fn(agent)
  assert.ok(!result, description)
}

function equals(agent, param, description) {
  const [leftFn, leftProp] = param.left.split('.')
  const [rightFn, rightProp] = param.right.split('.')
  const left = parameters[leftFn](agent)
  const right = parameters[rightFn](agent)
  assert.equal(left[leftProp], right[rightProp], description)
}

function matches(agent, param, description) {
  const [fn, prop] = param.object.split('.')
  const data = parameters[fn](agent)
  assert.equal(data[prop], param.value, description)
}

function agentOutput(agent, output) {
  const txData = agent.transactionEventAggregator.getEvents()
  if (output.transactions.length === 0) {
    assert.deepEqual(txData, output.transactions)
  } else {
    assert.equal(txData[0][0].name, `OtherTransaction/Nodejs/${output.transactions[0].name}`)
  }

  const spans = agent.spanEventAggregator.getEvents()

  if (output.spans.length === 0) {
    assert.deepEqual(spans, output.spans)
  } else {
    output.spans.forEach((span, i) => {
      const name = span.entryPoint ? `OtherTransaction/Nodejs/${span.name}` : span.name
      const spanFromAgent = spans.find((s) => s.intrinsics.name === name)
      assert.equal(spanFromAgent.intrinsics.category, span.category)
      if (span.entryPoint) {
        assert.equal(spanFromAgent.intrinsics['nr.entryPoint'], true)
      }

      assert.equal(spanFromAgent.intrinsics.name, name)

      if (span.parentName) {
        const parent = spans.find((s) => {
         const name = s.intrinsics['nr.entryPoint'] ? `OtherTransaction/Nodejs/${span.parentName}` : span.parentName
          return s.intrinsics.name === name 
        }) 
        assert.equal(spanFromAgent.intrinsics.parentId, parent.intrinsics.guid)
      }
    })
  }

}

module.exports = {
  agentOutput,
  equals,
  matches,
  notValid
}
