/*
 * Copyright 2020 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

// TODO: convert to normal tap style.
// Below allows use of mocha DSL with tap runner.
const tap = require('tap')

var chai = require('chai')
var expect = chai.expect
var helper = require('../../lib/agent_helper')
var sinon = require('sinon')
var Shim = require('../../../lib/shim/shim')

tap.test('with a promise', function(t) {
    t.autoend()
    var agent = null
    var promise = null
    var toWrap = null
    var shim = null

    t.beforeEach(function() {
      debugger;
      agent = helper.loadMockedAgent()
      shim = new Shim(agent, 'test-module')
      var defer = {}
      promise = new Promise(function(resolve, reject) {
        defer.resolve = resolve
        defer.reject = reject
      })
      promise.resolve = defer.resolve
      promise.reject = defer.reject

      toWrap = function() {
        promise.segment = agent.tracer.getSegment()
        return promise
      }
    })

    t.afterEach(function() {
      helper.unloadAgent(agent)
      promise = null
      toWrap = null
      shim = null
      agent = null
    })

    t.test('should make the segment translucent when promise resolves', function(t) {
      debugger;
      var wrapped = shim.record(toWrap, function() {
        return {name: 'test segment', promise: true, opaque: true}
      })

      helper.runInTransaction(agent, function() {
        var ret = wrapped()
        t.ok(ret instanceof Object.getPrototypeOf(promise).constructor)
        ret.then(function(val) {
          t.equal(result, val)
          t.equal(promise.segment.opaque, false)
          t.end()
        }).catch(t.end)
      })

      t.equal(promise.segment.opaque, true)
      var result = {}
      setTimeout(function() {
        promise.resolve(result)
      }, 5)
    })

  /*
    t.test('should touch the segment when promise resolves', function(t) {
      var wrapped = shim.record(toWrap, function() {
        return {name: 'test segment', promise: true}
      })

      helper.runInTransaction(agent, function() {
        var ret = wrapped()
        t.ok(ret instanceof Object.getPrototypeOf(promise).constructor)

        ret.then(function(val) {
          t.equal(result, val)
          t.ok(promise.segment.timer.getDurationInMillis() > oldDur)
          t.end()
        }).catch(t.end)
      })

      var oldDur = promise.segment.timer.getDurationInMillis()
      var result = {}
      setTimeout(function() {
        promise.resolve(result)
      }, 5)
    })*/

    /*
    it('should make the segment translucent when promise rejects', function(done) {
      var wrapped = shim.record(toWrap, function() {
        return {name: 'test segment', promise: true, opaque: true}
      })

      helper.runInTransaction(agent, function() {
        var ret = wrapped()
        expect(ret).to.be.instanceOf(Object.getPrototypeOf(promise).constructor)

        ret.then(function() {
          done(new Error('Should not have resolved!'))
        }, function(err) {
          expect(err).to.equal(result)
          expect(promise.segment.opaque).to.be.false
          done()
        }).catch(done)
      })

      expect(promise.segment.opaque).to.be.true
      var result = {}
      setTimeout(function() {
        promise.reject(result)
      }, 5)
    })

    it('should touch the segment when promise rejects', function(done) {
      var wrapped = shim.record(toWrap, function() {
        return {name: 'test segment', promise: true}
      })

      helper.runInTransaction(agent, function() {
        var ret = wrapped()
        expect(ret).to.be.instanceOf(Object.getPrototypeOf(promise).constructor)

        ret.then(function() {
          done(new Error('Should not have resolved!'))
        }, function(err) {
          expect(err).to.equal(result)
          expect(promise.segment.timer.getDurationInMillis()).to.be.above(oldDur)
          done()
        }).catch(done)
      })

      var oldDur = promise.segment.timer.getDurationInMillis()
      var result = {}
      setTimeout(function() {
        promise.reject(result)
      }, 5)
    })

    it('should not affect unhandledRejection event', function(done) {
      var wrapped = shim.record(toWrap, function() {
        return {name: 'test segment', promise: true}
      })

      helper.runInTransaction(agent, function() {
        var ret = wrapped()
        expect(ret).to.be.instanceOf(Object.getPrototypeOf(promise).constructor)

        process.on('unhandledRejection', function(err, p) {
          expect(err).to.equal(result)
          expect(p).to.equal(ret)
          done()
        })
      })

      var result = {}
      setTimeout(function() {
        promise.reject(result)
      }, 5)
    })
    */
  })
