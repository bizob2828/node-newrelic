'use strict'
const semver = require('semver')
const { pathToFileURL } = require('url')
const isSupportedVersion = () => semver.gte(process.version, 'v16.12.0')

function getGlobalRefs() {
  if (!globalThis.newrelic) {
    globalThis.newrelic = require('./index')
  }

  if (!globalThis.shimemr) {
    globalThis.shimmer = require('./lib/shimmer')
  }

  if (!globalThis.logger) {
    const loggingModule = require('./lib/logger')
    globalThis.logger = loggingModule.child({ component: 'esm-loader' })
  }

}


/**
 * Used as a proxy for files we need in esm loader
 * Since they now run in their own threads and you cannot
 * pass complex objects from thread to parent we have to add
 * some packages on a global scope and check if they exist before
 * requiring them for the first time
*/
module.exports = () => { 
  getGlobalRefs()
  /** TODO: load entry point
  const customEntryPoint = newrelic?.agent?.config?.api.esm.custom_instrumentation_entrypoint

  // Hook point within agent for customers to register their custom instrumentation.
  if (customEntryPoint) {
    const resolvedEntryPoint = path.resolve(customEntryPoint)
    logger.debug('Registering custom ESM instrumentation at %s', resolvedEntryPoint)
    require(resolvedEntryPoint)
  }
  */

  globalThis.esmShimPath = pathToFileURL(require.resolve('./lib/esm-shim.mjs'))
  addESMSupportabilityMetrics()
  return { esmShimPath, isSupportedVersion }
}

/**
 * Helper function for determining which of our Supportability metrics to use for the current loader invocation
 *
 * @param {object} agent
 *        instantiation of the New Relic agent
 * @returns {void}
 */
function addESMSupportabilityMetrics() {
  const agent = globalThis?.newrelic?.agent
  if (!agent) {
    return
  }
  
  const NAMES = require('./lib/metrics/names')

  if (isSupportedVersion()) {
    agent.metrics.getOrCreateMetric(NAMES.FEATURES.ESM.LOADER).incrementCallCount()
  } else {
    logger.warn(
      'New Relic for Node.js ESM loader requires a version of Node >= v16.12.0; your version is %s.  Instrumentation will not be registered.',
      process.version
    )
    agent.metrics.getOrCreateMetric(NAMES.FEATURES.ESM.UNSUPPORTED_LOADER).incrementCallCount()
  }

  /*if (customEntryPoint) {
    agent.metrics.getOrCreateMetric(NAMES.FEATURES.ESM.CUSTOM_INSTRUMENTATION).incrementCallCount()
  }*/
}
