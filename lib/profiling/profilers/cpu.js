/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'
const { AsyncLocalStorage } = require('async_hooks')
const BaseProfiler = require('./base')

/**
 * Whether V8's AsyncContextFrame (ACF) is active (Node 24+ by default, or
 * earlier with `--experimental-async-context-frame`). With ACF, `run`
 * delegates to `enterWith` for both entry and restore; without it, `run` does
 * not call `enterWith` at all. We feature-detect that delegation rather than
 * sniff the Node version so a `--no-async-context-frame` override is respected.
 */
const ASYNC_CONTEXT_FRAME_ACTIVE = (() => {
  let active = false
  const als = new AsyncLocalStorage()
  als.enterWith = () => { active = true }
  als.run(1, () => {})
  als.disable()
  return active
})()

/**
 * Produces a wall time stack profile via `pprof`.
 * The native sampler fires at a fixed rate against whatever JS is currently
 * on the stack, and the active context is tracked by hooking the agent's
 * `AsyncLocalStorage` (`this.#store`) instance.
 *
 * Two context-tracking strategies are used depending on the runtime:
 * - With AsyncContextFrame (ACF) active, pprof's `useCPED` carries the sample
 *   context per async-context-frame, so we just `setContext` the active span on
 *   each `enterWith` and let the frame propagate/restore it.
 * - Without ACF, we keep a single mutable holder pointed at by the profiler and
 *   swap it whenever a sample lands, plus hook `run` and async resumptions to
 *   keep it current.
 *
 * The wall-clock (or just wall) time for a function measures the time elapsed
 * between entering and exiting a function. Wall time includes all wait time,
 * including that for locks and thread synchronization.
 */
class CpuProfiler extends BaseProfiler {
  #pprof
  #tracer
  #durationMillis
  #intervalMicros = (1e3 / 99) * 1000 // samples at 99hz(99 times per second)
  #kSampleCount
  // Whether to use pprof's per-frame context (CPED) path. True when ACF is
  // active; otherwise we fall back to the mutable-holder strategy.
  #useCPED = ASYNC_CONTEXT_FRAME_ACTIVE
  // (non-CPED only) The "context" reference handed to the pprof time profiler.
  // The native sampler captures whatever `current` holds at the moment a sample
  // is taken, so we keep it pointed at the active transaction's trace/span ids.
  #context = { current: {} }
  #state
  #lastSampleCount = 0
  // The agent's `AsyncLocalStorage` instance we use to get the active context.
  #store
  // Caches the resolved transaction name so `getFullName()` (which re-runs the
  // name normalizer while a transaction is in-flight) isn't called on every
  // context change.
  #nameCache = { transaction: null, name: '' }
  // The original `AsyncLocalStorage.run`/`enterWith`, saved when we monkeypatch
  // them so `#unhookContext` can restore them once profiling stops.
  #origRun
  #origEnterWith
  // (non-CPED only) async_hooks hook that refreshes the active context on every
  // async resumption (see `#hookAsyncResume`). Disabled on stop.
  #asyncHook

  constructor({ logger, samplingInterval, tracer }) {
    super({ logger })
    this.#pprof = require('@datadog/pprof')
    this.#kSampleCount = this.#pprof.time.constants.kSampleCount
    this.#tracer = tracer
    this.#store = tracer._contextManager._asyncLocalStorage
    this.#durationMillis = samplingInterval
  }

  start() {
    if (this.#pprof.time.isStarted()) {
      this.logger.trace('CpuProfiler is already started, not calling start again.')
      return
    }

    this.logger.trace(`Starting CpuProfiler, sample every ${this.#intervalMicros}hz for ${this.#durationMillis} ms.`)
    this.#pprof.time.start({
      durationMillis: this.#durationMillis,
      intervalMicros: this.#intervalMicros,
      // needed for trace_id + span_id label
      withContexts: true,
      // carry the sample context per async-context-frame when ACF is active
      useCPED: this.#useCPED
    })

    if (this.#useCPED) {
      this.#hookEnterWith()
    } else {
      this.#state = this.#pprof.time.getState()
      this.#resetContext()
      this.#hookRun()
      this.#hookAsyncResume()
    }
  }

  stop() {
    if (!this.#pprof.time.isStarted()) {
      this.logger.trace('CpuProfiler is not started, not stopping.')
      return
    }

    // Tear down our hooks before stopping so no in-flight context switch or
    // async resumption mutates a stopped profiler's context.
    this.#unhookContext()
    this.#pprof.time.stop(false)
  }

  async collect() {
    if (!this.#useCPED) {
      // Flush the freshest context so samples taken since the last context
      // switch aren't attributed to a stale span before sampling restarts.
      this.#updateContext()
    }
    const profile = this.#pprof.time.stop(true, this.#linkContext)
    if (!this.#useCPED) {
      // `stop(true)` restarts sampling, so start a fresh holder for the next
      // collection cycle. With CPED the per-frame contexts survive the restart.
      this.#resetContext()
    }
    return this.#pprof.encode(profile)
  }

  /**
   * Points the pprof time profiler at a fresh `#context` and resyncs the
   * sample counter.
   */
  #resetContext() {
    this.#context = { current: {} }
    this.#lastSampleCount = this.#state?.[this.#kSampleCount] ?? 0
    this.#pprof.time.setContext(this.#context)
  }

  /**
   * pprof's `generateLabels` callback. For each captured sample context it
   * returns the span label that was active when the sample was taken.
   *
   * @param {object} params params from pprof
   * @param {object} params.context the captured time profile node context
   * @returns {object} label set applied to the pprof sample
   */
  #linkContext = ({ context }) => {
    const captured = context?.context
    // With CPED the object we passed to `setContext` is captured directly;
    // without it, the captured value is the holder whose `current` we swap.
    return (this.#useCPED ? captured : captured?.current) ?? {}
  }

  /**
   * Builds the span label for the active context: a `span:`-prefixed key mapped
   * to a comma-separated `key=value` value, or `{}` when no transaction is
   * active.
   *
   * @returns {object} the label set (at most one `span:` entry)
   */
  #buildLabel() {
    const ctx = this.#tracer.getContext()
    const transaction = ctx?.transaction
    const traceId = transaction?.traceId
    const spanId = ctx?.segment?.getSpanId?.()

    if (!traceId) {
      return {}
    }

    const ids = [`trace_id=${traceId}`]
    if (spanId) {
      // Should be in span_id, trace_id order
      ids.unshift(`span_id=${spanId}`)
    }
    return { [this.#spanKey(transaction)]: ids.join(',') }
  }

  /**
   * Refreshes the pprof sample context with the active span.
   * - CPED: writes the label straight into the current async-context-frame.
   * - non-CPED: swaps in a fresh holder once a sample has landed (so earlier
   *   samples keep their ids), then reassigns its `current` to the active span.
   */
  #updateContext = () => {
    if (this.#useCPED) {
      this.#pprof.time.setContext(this.#buildLabel())
      return
    }

    const sampleCount = this.#state?.[this.#kSampleCount]
    if (sampleCount !== this.#lastSampleCount) {
      this.#lastSampleCount = sampleCount
      this.#context = { current: {} }
      this.#pprof.time.setContext(this.#context)
    }

    // Reassign `current` every run() between two samples, because a sample must
    // reflect only the span active when it was taken, not every span seen this
    // sample window.
    this.#context.current = this.#buildLabel()
  }

  /**
   * Builds the `span:` label key. The portion after `span:` is not consumed
   * externally; we'll use internal transaction id + transaction name for the key:
   * `span:<transaction.id>:<name>` to match other language agents' implementation.
   * The name is resolved (and cached per transaction) via `getFullName()`.
   *
   * @param {Transaction} transaction the active transaction
   * @returns {string} the label key
   */
  #spanKey(transaction) {
    if (transaction !== this.#nameCache.transaction || !this.#nameCache.name) {
      this.#nameCache = { transaction, name: transaction.getFullName() || '' }
    }

    const prefix = `span:${transaction.id}`
    return this.#nameCache.name ? `${prefix}:${this.#nameCache.name}` : prefix
  }

  /**
   * (CPED path) Wraps `enterWith` on the agent's `AsyncLocalStorage`. With ACF,
   * `run` delegates to `enterWith` for both entry and restore, so this single
   * hook covers every context switch. After each switch we `setContext` the
   * active span into the current async-context-frame; the frame then propagates
   * that context to async continuations and restores the parent's on unwind,
   * which removes the need for the holder swap, `run` wrap, and async hook.
   */
  #hookEnterWith() {
    const self = this
    this.#origEnterWith = this.#store.enterWith
    const origEnterWith = this.#origEnterWith
    this.#store.enterWith = function (store) {
      const retVal = origEnterWith.call(this, store)
      self.#updateContext()
      return retVal
    }
  }

  /**
   * (non-CPED path) Wraps `run` on the agent's single `AsyncLocalStorage` so the
   * pprof holder is refreshed on every context switch: on `run` entry (the agent
   * propagates all transaction context through this one instance) and on `run`
   * exit (so a sibling doesn't inherit a returned child's span). It wraps the
   * instance, not the prototype, leaving other libraries' ALS untouched.
   */
  #hookRun() {
    const self = this
    this.#origRun = this.#store.run
    const origRun = this.#origRun
    this.#store.run = function (store, callback, ...args) {
      function wrapped(...cbArgs) {
        self.#updateContext()
        return callback.apply(this, cbArgs)
      }
      try {
        return origRun.call(this, store, wrapped, ...args)
      } finally {
        self.#updateContext()
      }
    }
  }

  /**
   * (non-CPED path) `run` only fires on explicit context entry/exit. When an
   * async callback resumes (timer, promise continuation, I/O),
   * `AsyncLocalStorage` restores the active store without a `run` call, so
   * `#context.current` would otherwise stay frozen at the last `run`'s span. A
   * `before` hook refreshes it on every resumption so those samples get the
   * right span.
   */
  #hookAsyncResume() {
    // eslint-disable-next-line n/no-unsupported-features/node-builtins
    const { createHook } = require('async_hooks')
    this.#asyncHook = createHook({ before: () => this.#updateContext() })
    this.#asyncHook.enable()
  }

  /**
   * Reverses the hooks installed by `start`: restores the original
   * `run`/`enterWith` and disables the async hook so none fire once the profiler
   * has stopped.
   */
  #unhookContext() {
    if (this.#origRun) {
      this.#store.run = this.#origRun
      this.#origRun = null
    }
    if (this.#origEnterWith) {
      this.#store.enterWith = this.#origEnterWith
      this.#origEnterWith = null
    }
    this.#asyncHook?.disable()
    this.#asyncHook = null
  }
}

module.exports = CpuProfiler
