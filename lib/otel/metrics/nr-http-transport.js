/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const http = require('node:http')
const https = require('node:https')

const MAX_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 5000
const BACKOFF_MULTIPLIER = 1.5
const JITTER = 0.2
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504])
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH'
])

function jitteredBackoff(nextBackoffMillis) {
  // eslint-disable-next-line sonarjs/pseudo-random -- jitter does not need cryptographic randomness
  const jitter = Math.random() * (2 * JITTER) - JITTER
  return Math.max(Math.min(nextBackoffMillis * (1 + jitter), MAX_BACKOFF_MS), 0)
}

function parseRetryAfterMillis(value) {
  if (value == null) {
    return undefined
  }
  const seconds = Number.parseInt(value, 10)
  if (Number.isInteger(seconds)) {
    return seconds > 0 ? seconds * 1000 : -1
  }
  const delayMillis = new Date(value).getTime() - Date.now()
  return delayMillis >= 0 ? delayMillis : 0
}

function delay(millis) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(millis, 0))
    // A retry backoff pause is not active work -- it must never be the
    // thing keeping a process alive (e.g. a leaked reader retrying against
    // an unreachable host should not block process exit).
    timer.unref?.()
  })
}

/**
 * Minimal replacement for the retrying OTLP/HTTP export delegate supplied
 * by `@opentelemetry/otlp-exporter-base`. Posts protobuf bytes to a single
 * endpoint and retries on the same status/error codes upstream treats as
 * retryable. Unlike upstream, this does not support compression or a
 * concurrency-limited queue, since the agent never configures either.
 */
class NrHttpTransport {
  #url
  #headers
  #agentFactory
  #agent
  #timeoutMillis

  /**
   * @param {object} params Constructor parameters.
   * @param {string} params.url Destination URL to POST data to.
   * @param {object} params.headers HTTP headers to send with every request.
   * @param {Function} [params.agentFactory] Factory invoked once, lazily, to
   * obtain the `http.Agent`/`https.Agent` instance to use. Resolved lazily
   * (and memoized) rather than in the constructor so that a throwing
   * factory only fails the export in progress instead of the exporter's
   * construction.
   * @param {number} [params.timeoutMillis] Overall deadline for a single
   * `send` call, including retries.
   */
  constructor({ url, headers = {}, agentFactory, timeoutMillis = 10_000 }) {
    this.#url = new URL(url)
    this.#headers = headers
    this.#agentFactory = agentFactory
    this.#timeoutMillis = timeoutMillis
  }

  /**
   * Sends data, retrying on retryable failures until the deadline elapses
   * or the maximum attempts are exhausted.
   *
   * @param {Buffer|Uint8Array} data Serialized request body.
   * @returns {Promise<Buffer>} The response body on success.
   */
  async send(data) {
    const deadline = Date.now() + this.#timeoutMillis
    let attempts = MAX_ATTEMPTS
    let nextBackoff = INITIAL_BACKOFF_MS
    let result = await this.#sendOnce(data, deadline - Date.now())

    while (result.status === 'retryable' && attempts > 0) {
      attempts -= 1
      const backoff = jitteredBackoff(nextBackoff)
      nextBackoff *= BACKOFF_MULTIPLIER
      const retryInMillis = Math.max(result.retryInMillis ?? backoff, 0)
      const remainingMillis = deadline - Date.now()
      if (retryInMillis > remainingMillis) {
        break
      }
      await delay(retryInMillis)
      result = await this.#sendOnce(data, deadline - Date.now())
    }

    if (result.status === 'success') {
      return result.data
    }
    throw result.error
  }

  #sendOnce(data, timeoutMillis) {
    return new Promise((resolve) => {
      if (this.#agent === undefined && this.#agentFactory) {
        try {
          this.#agent = this.#agentFactory()
        } catch (error) {
          resolve({ status: 'failure', error })
          return
        }
      }

      const requestTimeoutMillis = Math.max(timeoutMillis, 0)
      const transport = this.#url.protocol === 'http:' ? http : https
      const req = transport.request(
        this.#url,
        { method: 'POST', headers: this.#headers, agent: this.#agent },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            const body = Buffer.concat(chunks)
            if (res.statusCode <= 299) {
              resolve({ status: 'success', data: body })
            } else if (RETRYABLE_STATUS_CODES.has(res.statusCode)) {
              resolve({
                status: 'retryable',
                retryInMillis: parseRetryAfterMillis(res.headers['retry-after'])
              })
            } else {
              resolve({
                status: 'failure',
                error: new Error(
                  `OTLP export failed with status ${res.statusCode}: ${body.toString()}`
                )
              })
            }
          })
        }
      )

      req.setTimeout(requestTimeoutMillis, () => {
        req.destroy()
        resolve({ status: 'retryable', error: new Error('Request timed out') })
      })

      req.on('error', (error) => {
        if (RETRYABLE_NETWORK_CODES.has(error.code)) {
          resolve({ status: 'retryable', error })
        } else {
          resolve({ status: 'failure', error })
        }
      })

      req.end(data)
    })
  }
}

module.exports = NrHttpTransport
