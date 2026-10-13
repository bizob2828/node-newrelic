/*
 * Copyright 2025 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const NR_KEY = process.env.NEW_RELIC_LICENSE_KEY
if (NR_KEY === null) {
  console.error('Missing required environment variable: NEW_RELIC_LICENSE_KEY.')
  process.exit(1)
}

const HOST = process.env.NEW_RELIC_METRICS_HOST || 'staging-collector.newrelic.com'

const MeterProvider = require('../lib/otel/metrics/sdk/meter-provider.js')
const PeriodicMetricReader = require('../lib/otel/metrics/sdk/periodic-metric-reader.js')
const NROTLPMetricExporter = require('../lib/otel/metrics/nr-exporter.js')
const { resourceFromAttributes } = require('../lib/otel/metrics/nr-resource.js')

// This script runs standalone, outside of an agent instance, so the
// exporter/delegate chain gets minimal stand-ins for the pieces it expects:
// an agent-shaped object (for Supportability-metric side effects we don't
// care about here) and a logger (for audit logging we don't need).
const fakeAgent = {
  metrics: {
    getOrCreateMetric() {
      return { incrementCallCount() {} }
    }
  }
}
const fakeLogger = {
  child() { return this },
  debug() {},
  warn(...args) { console.warn(...args) },
  audit() {},
  auditEnabled() { return false }
}

const resource = resourceFromAttributes({
  'service.name': 'nodejs-benchmark-runner'
})

const exporter = new NROTLPMetricExporter(
  {
    url: `https://${HOST}:443/v1/metrics`,
    headers: { 'api-key': NR_KEY }
  },
  { agent: fakeAgent, logger: fakeLogger }
)

const reader = new PeriodicMetricReader({ exporter, exportIntervalMillis: 1000 })
const meterProvider = new MeterProvider({ reader, resource })

const meter = meterProvider.getMeter('nodejs-agent-benchmarks')

// A single, reusable gauge for all benchmark measurements.
const benchmarkValueGauge = meter.createGauge('nodejs_benchmark.value', {
  description: 'The value of a specific benchmark measurement.'
})

/**
 * Sanitizes a string to create a valid metric name
 * by replacing slashes with dots and removing the '.bench.js' suffix.
 * @param {string} str The string to sanitize.
 * @returns {string} The sanitized string.
 */
function sanitize(str) {
  return str.replace(/\//g, '.').replace(/\.bench\.js$/, '').replace(/[\s-]/g, '_')
}

/**
 * Normalizes and sends metrics for a single benchmark file's results.
 * @param {object} benchmarkFileData The benchmark test file data e.g. { name: 'test.bench.js', parsedOutput: { 'test case 1': { mean: 123, max: 456 }, ... } }
 * @param {object} commonAttributes Common attributes to add to all metrics, like Node version.
 */
function sendBenchmarkTestMetrics(benchmarkFileData, commonAttributes = {}) {
  const fileName = benchmarkFileData.name
  const testCases = benchmarkFileData.parsedOutput

  if (!fileName || !testCases) {
    console.error('Could not process benchmark data due to invalid format:', benchmarkFileData)
    return
  }

  const suiteName = sanitize(fileName)
  console.log(`--- Sending metrics for ${fileName} ---`)

  // measurements will contain the following:
  // 'mean', 'max', 'min', 'median', '5thPercentile', '95thPercentile', 'stdDev', 'numSamples'
  for (const [caseName, measurements] of Object.entries(testCases)) {
    const sanitizedCaseName = sanitize(caseName)
    for (const [metricKey, metricValue] of Object.entries(measurements)) {
      if (metricKey === 'numSamples') continue
      if (typeof metricValue === 'number' && !isNaN(metricValue)) {
        const attributes = {
          ...commonAttributes,
          suite_name: suiteName,
          case_name: sanitizedCaseName,
          metric_type: metricKey,
          numSamples: measurements.numSamples
        }
        benchmarkValueGauge.record(metricValue, attributes)
      }
    }
  }
}

module.exports = { sendBenchmarkTestMetrics, meterProvider }
