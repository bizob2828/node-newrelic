/*
 * Copyright 2021 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// TODO: move to a different folder?
// TODO: remove some of these from async_local and new promise tests so those are only testing relevant
// segment map parts?

'use strict'

const test = require('tap').test
const helper = require('../../lib/agent_helper')
const asyncHooks = require('async_hooks')

test('await', function (t) {
  const agent = setupAgent(t)
  helper.runInTransaction(agent, async function (txn) {
    let transaction = agent.getTransaction()
    t.equal(transaction && transaction.id, txn.id, 'should start in a transaction')

    await Promise.resolve("i'll be back")

    transaction = agent.getTransaction()
    t.equal(
      transaction && transaction.id,
      txn.id,
      'should resume in the same transaction after await'
    )

    txn.end()
    t.end()
  })
})

test("the agent's async hook", function (t) {
  let tagent = null
  class TestResource extends asyncHooks.AsyncResource {
    constructor(id) {
      super('PROMISE', id)
    }

    doStuff(callback) {
      let context = tagent && tagent.ctxMgr.active
      process.nextTick(() => {
        context = tagent && tagent.ctxMgr.active
        const wrappedCb = tagent.ctxMgr.runIn({
          scope: context,
          cb: callback
        })
        this.runInAsyncScope(wrappedCb)
      })
    }
  }

  t.autoend()
  t.test('does not crash on multiple resolve calls', function (t) {
    const agent = setupAgent(t)
    helper.runInTransaction(agent, function () {
      t.doesNotThrow(function () {
        new Promise(function (res) {
          res()
          res()
        }).then(t.end)
      })
    })
  })

  // TODO: propagates the missing state
  t.test('does not restore a segment for a resource created outside a transaction', (t) => {
    const agent = setupAgent(t)
    tagent = agent
    const res = new TestResource(1)
    helper.runInTransaction(agent, function () {
      const root = agent.ctxMgr.active.segment

      res.doStuff(function () {
        // runInAsyncScope results in running outside of context
        // and ends up propagating 'null' segment here as there's likely no context
        t.ok(agent.ctxMgr.active.segment, 'should be in a transaction')
        t.equal(
          agent.ctxMgr.active.segment.name,
          root.name,
          'loses transaction state for resources created outside of a transaction'
        )
        t.end()
      })
    })
  })

  t.test('restores context in inactive transactions', function (t) {
    const agent = setupAgent(t)
    helper.runInTransaction(agent, function (txn) {
      const res = new TestResource(1)
      const root = agent.ctxMgr.active.segment
      txn.end()
      res.doStuff(function () {
        t.equal(
          agent.ctxMgr.active.segment,
          root,
          'should restore a segment when its transaction has been ended'
        )
        t.end()
      })
    })
  })

  // TODO: this is broken. do we need to care about this use case?
  t.test('parent promises persist perspective to problematic progeny', (t) => {
    const agent = setupAgent(t)
    const tasks = []
    const intervalId = setInterval(() => {
      while (tasks.length) {
        tasks.pop()()
      }
    }, 10)

    t.teardown(() => {
      clearInterval(intervalId)
    })

    helper.runInTransaction(agent, function (txn) {
      t.ok(txn, 'transaction should not be null')

      let context = agent.ctxMgr.active

      const p = Promise.resolve()

      tasks.push(agent.ctxMgr.runIn({
        scope: context,
        cb: () => {
          context = agent.ctxMgr.active
          p.then(() => {
            context = agent.ctxMgr.active
            const tx = agent.getTransaction()
            t.equal(tx ? tx.id : null, txn.id)
            t.end()
          })
        }
      }))
    })
  })

  // TODO: this is broken. do we need to care about this use case?
  /**
   * Variation of 'parent promises persist perspective to problematic progeny' from async_hooks.js.
   *
   * For unresolved parent promises, persistance should still work as expected.
   */
  t.test('unresolved parent promises persist to problematic progeny', { skip: true }, (t) => {
    const agent = setupAgent(t)
    const tasks = []
    const intervalId = setInterval(() => {
      while (tasks.length) {
        tasks.pop()()
      }
    }, 10)

    t.teardown(() => {
      clearInterval(intervalId)
    })

    helper.runInTransaction(agent, function (txn) {
      t.ok(txn, 'transaction should not be null')

      let context = agent.ctxMgr.active

      let parentResolve = null
      const p = new Promise((resolve) => {
        context = agent.ctxMgr.active
        parentResolve = resolve
      })

      tasks.push(agent.ctxMgr.runIn({
        scope: context,
        cb: () => {
          context = agent.ctxMgr.active
          p.then(() => {
            context = agent.ctxMgr.active
            const tx = agent.getTransaction()
            t.equal(tx ? tx.id : null, txn.id)

            t.end()
          })
          // resolve parent after continuation scheduled
          parentResolve()
        }
      }))
    })
  })

  // TODO: the timer hop screws up the propagation regardless
  // setinterval was created prior to everything and then schedules bound to
  // no context. there isn't even a handoff
  t.test('maintains transaction context', function (t) {
    const agent = setupAgent(t)
    const tasks = []
    const intervalId = setInterval(() => {
      while (tasks.length) {
        tasks.pop()()
      }
    }, 10)

    t.teardown(() => {
      clearInterval(intervalId)
    })

    helper.runInTransaction(agent, function (txn) {
      t.ok(txn, 'transaction should not be null')

      let context = agent.ctxMgr.active

      const segment = txn.trace.root
      agent.tracer.bindFunction(one, segment)()

      const wrapperTwo = agent.tracer.bindFunction(function () {
        let context = agent.ctxMgr.active
        return two()
      }, segment)
      const wrapperThree = agent.tracer.bindFunction(function () {
        let context = agent.ctxMgr.active
        return three()
      }, segment)

      function one() {
        let context = agent.ctxMgr.active
        return new Promise(executor).then(() => {
          let context = agent.ctxMgr.active
          const tx = agent.getTransaction()
          t.equal(tx ? tx.id : null, txn.id)
          t.end()
        })
      }

      function executor(resolve) {
        let context = agent.ctxMgr.active
        tasks.push(() => {
          let context = agent.ctxMgr.active
          next().then(() => {
            let context = agent.ctxMgr.active
            const tx = agent.getTransaction()
            t.equal(tx ? tx.id : null, txn.id)
            resolve()
          })
        })
      }

      function next() {
        let context = agent.ctxMgr.active
        return Promise.resolve(wrapperTwo())
      }

      function two() {
        let context = agent.ctxMgr.active
        return nextTwo()
      }

      function nextTwo() {
        let context = agent.ctxMgr.active
        return Promise.resolve(wrapperThree())
      }

      function three() {}
    })
  })

  // Don't have this manual check in async-hooks anymore
  // TODO: should we build something in to transaction end / instrumentation to
  // stop passing on segments or not worry about it?
  // t.test('stops propagation on transaction end', function (t) {
  //   const agent = setupAgent(t)

  //   helper.runInTransaction(agent, function (txn) {
  //     t.ok(txn, 'transaction should not be null')
  //     const segment = txn.trace.root
  //     agent.tracer.bindFunction(one, segment)()

  //     function one() {
  //       return new Promise((done) => {
  //         const currentSegment = agent.ctxMgr.active.segment
  //         t.ok(currentSegment, 'should have propagated a segment')
  //         txn.end()

  //         done()
  //       }).then(() => {
  //         const currentSegment = agent.ctxMgr.active.segment
  //         t.notOk(currentSegment, 'should not have a propagated segment')
  //         t.end()
  //       })
  //     }
  //   })
  // })

  // TODO: this test likely not fully testing cause of the timer hop issue
  t.test('loses transaction context', function (t) {
    const agent = setupAgent(t)
    const tasks = []
    const intervalId = setInterval(() => {
      while (tasks.length) {
        tasks.pop()()
      }
    }, 10)

    t.teardown(() => {
      clearInterval(intervalId)
    })

    helper.runInTransaction(agent, function (txn) {
      t.ok(txn, 'transaction should not be null')
      const segment = txn.trace.root
      agent.tracer.bindFunction(one, segment)()

      const wrapperTwo = agent.tracer.bindFunction(function () {
        return two()
      }, segment)

      function one() {
        return new Promise(executor).then(() => {
          const tx = agent.getTransaction()
          t.equal(tx ? tx.id : null, txn.id)
          t.end()
        })
      }

      function executor(resolve) {
        tasks.push(() => {
          next().then(() => {
            const tx = agent.getTransaction()
            // We know tx will be null here because no promise was returned
            // If this test fails, that's actually a good thing,
            // so throw a party/update Koa.
            t.equal(tx, null)
            resolve()
          })
        })
      }

      function next() {
        return Promise.resolve(wrapperTwo())
      }

      function two() {
        // No promise is returned to reinstate transaction context
      }
    })
  })

  t.test('handles multientry callbacks correctly', function (t) {
    const agent = setupAgent(t)

    helper.runInTransaction(agent, function () {
      const root = agent.ctxMgr.active.segment

      const aSeg = agent.tracer.createSegment('A')
      agent.tracer.segment = aSeg

      const resA = new TestResource(1)

      const bSeg = agent.tracer.createSegment('B')
       agent.tracer.segment = bSeg
      const resB = new TestResource(2)

      agent.tracer.segment = root

      resA.doStuff(() => {
        t.equal(
          agent.ctxMgr.active.segment.name,
          aSeg.name,
          'runInAsyncScope should restore the segment active when a resource was made'
        )

        resB.doStuff(() => {
          t.equal(
            agent.ctxMgr.active.segment.name,
            bSeg.name,
            'runInAsyncScope should restore the segment active when a resource was made'
          )

          t.end()
        })
        t.equal(
          agent.ctxMgr.active.segment.name,
          aSeg.name,
          'runInAsyncScope should restore the segment active when a callback was called'
        )
      })
      t.equal(
        agent.ctxMgr.active.segment.name,
        root.name,
        'root should be restored after we are finished'
      )
      resA.doStuff(() => {
        t.equal(
          agent.ctxMgr.active.segment.name,
          aSeg.name,
          'runInAsyncScope should restore the segment active when a resource was made'
        )
      })
    })
  })
})

function checkCallMetrics(t, testMetrics) {
  // Tap also creates promises, so these counts don't quite match the tests.
  const TAP_COUNT = 1

  t.equal(testMetrics.initCalled - TAP_COUNT, 2, 'two promises were created')
  t.equal(testMetrics.beforeCalled, 1, 'before hook called for all async promises')
  t.equal(
    testMetrics.beforeCalled,
    testMetrics.afterCalled,
    'before should be called as many times as after'
  )

  if (global.gc) {
    global.gc()
    return setTimeout(function () {
      t.equal(
        testMetrics.initCalled - TAP_COUNT,
        testMetrics.destroyCalled,
        'all promises created were destroyed'
      )
      t.end()
    }, 10)
  }
  t.end()
}

test('promise hooks', function (t) {
  t.autoend()
  const testMetrics = {
    initCalled: 0,
    beforeCalled: 0,
    afterCalled: 0,
    destroyCalled: 0
  }

  const promiseIds = {}
  const hook = asyncHooks.createHook({
    init: function initHook(id, type) {
      if (type === 'PROMISE') {
        promiseIds[id] = true
        testMetrics.initCalled++
      }
    },
    before: function beforeHook(id) {
      if (promiseIds[id]) {
        testMetrics.beforeCalled++
      }
    },
    after: function afterHook(id) {
      if (promiseIds[id]) {
        testMetrics.afterCalled++
      }
    },
    destroy: function destHook(id) {
      if (promiseIds[id]) {
        testMetrics.destroyCalled++
      }
    }
  })
  hook.enable()

  t.test('are only called once during the lifetime of a promise', function (t) {
    new Promise(function (res) {
      setTimeout(res, 10)
    }).then(function () {
      setImmediate(checkCallMetrics, t, testMetrics)
    })
  })
})

function setupAgent(t) {
  const agent = helper.instrumentMockedAgent({
    feature_flag: { await_support: true }
  })
  t.teardown(function () {
    helper.unloadAgent(agent)
  })

  return agent
}
