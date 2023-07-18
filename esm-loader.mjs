/*
 * Copyright 2022 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url'
import semver from 'semver'

// This check will prevent resolve hooks executing from within this file
// If I do `import('foo')` in here it'll hit the resolve hook multiple times
const isFromEsmLoader = (context) =>
  context && context.parentURL && context.parentURL.includes('newrelic/esm-loader.mjs')

// exporting for testing purposes
export const registeredSpecifiers = new Map()
const isSupportedVersion = () => semver.gte(process.version, 'v16.12.0')

export function globalPreload() {
  return `
  const { createRequire } = getBuiltin('module');
  const { cwd } = getBuiltin('process')
  const require = createRequire(cwd())
  //const utils = require(cwd() + '/../../../esm-preload.js')
  const utils = require(cwd() + '/esm-preload.js')
  return utils()
  `
}

/**
 * Hook chain responsible for resolving a file URL for a given module specifier
 *
 * Our loader has to be the last user-supplied loader if chaining is happening,
 * as we rely on `nextResolve` being the default Node.js resolve hook to get our URL
 *
 * Docs: https://nodejs.org/api/esm.html#resolvespecifier-context-nextresolve
 *
 * @param {string} specifier string identifier in an import statement or import() expression
 * @param {object} context metadata about the specifier, including url of the parent module and any import assertions
 *        Optional argument that only needs to be passed when changed
 * @param {Function} nextResolve The subsequent resolve hook in the chain, or the Node.js default resolve hook after the last user-supplied resolve hook
 * @returns {Promise} Promise object representing the resolution of a given specifier
 */
export async function resolve(specifier, context, nextResolve) {
  const { newrelic, shimmer, logger } = globalThis 
  if (!newrelic.agent || !isSupportedVersion() || isFromEsmLoader(context)) {
    return nextResolve(specifier, context, nextResolve)
  }

  /**
   * We manually call the default Node.js resolve hook so
   * that we can get the fully qualified URL path and the
   * package type (commonjs/module/builtin) without
   * duplicating the logic of the Node.js hook
   */
  const resolvedModule = await nextResolve(specifier, context, nextResolve)
  const instrumentationName = shimmer.getInstrumentationNameFromModuleName(specifier)
  const instrumentationDefinition = shimmer.registeredInstrumentations[instrumentationName]

  if (instrumentationDefinition) {
    const { url, format } = resolvedModule
    logger.debug(`Instrumentation exists for ${specifier} ${format} package.`)

    if (format === 'commonjs') {
      // ES Modules translate import statements into fully qualified filepaths, so we create a copy of our instrumentation under this filepath
      const instrumentationDefinitionCopy = [...instrumentationDefinition]
      instrumentationDefinitionCopy.forEach((copy) => {
        // Stripping the prefix is necessary because the code downstream gets this url without it
        copy.moduleName = fileURLToPath(url)

        // Added to keep our Supportability metrics from exploding/including customer info via full filepath
        copy.specifier = specifier
        shimmer.registerInstrumentation(copy)
        logger.debug(
          `Registered CommonJS instrumentation for ${specifier} under ${copy.moduleName}`
        )
      })
    } else if (format === 'module') {
      registeredSpecifiers.set(url, specifier)
      const modifiedUrl = new URL(url)
      // add a query param to the resolved url so the load hook below knows
      // to rewrite and wrap the source code
      modifiedUrl.searchParams.set('hasNrInstrumentation', 'true')
      resolvedModule.url = modifiedUrl.href
    } else {
      logger.debug(`${specifier} is not a CommonJS nor ESM package, skipping for now.`)
    }
  }

  return resolvedModule
}

/**
 * Hook chain responsible for determining how a URL should be interpreted, retrieved, and parsed.
 *
 * Our loader has to be the last user-supplied loader if chaining is happening,
 * as we rely on `nextLoad` being the default Node.js resolve hook to load the ESM.
 *
 * Docs: https://nodejs.org/dist/latest-v18.x/docs/api/esm.html#loadurl-context-nextload
 *
 * @param {string} url the URL returned by the resolve chain
 * @param {object} context metadata about the url, including conditions, format and import assertions
 * @param {Function} nextLoad the subsequent load hook in the chain, or the Node.js default load hook after the last user-supplied load hook
 * @returns {Promise} Promise object representing the load of a given url
 */
export async function load(url, context, nextLoad) {
  const { newrelic, logger, esmShimPath } = globalThis 
  if (!newrelic.agent || !isSupportedVersion()) {
    return nextLoad(url, context, nextLoad)
  }

  let parsedUrl

  try {
    parsedUrl = new URL(url)
  } catch (err) {
    logger.error('Unable to parse url: %s, msg: %s', url, err.message)
    return nextLoad(url, context, nextLoad)
  }

  const hasNrInstrumentation = parsedUrl.searchParams.get('hasNrInstrumentation')

  if (!hasNrInstrumentation) {
    return nextLoad(url, context, nextLoad)
  }

  /**
   * undo the work we did in the resolve hook above
   * so we can properly rewrite source and not get in an infinite loop
   */
  parsedUrl.searchParams.delete('hasNrInstrumentation')

  const originalUrl = parsedUrl.href
  const specifier = registeredSpecifiers.get(originalUrl)
  const rewrittenSource = await wrapEsmSource(originalUrl, specifier, esmShimPath)
  logger.debug(`Registered module instrumentation for ${specifier}.`)

  return {
    format: 'module',
    source: rewrittenSource,
    shortCircuit: true
  }
}


/**
 * Rewrites the source code of a ES module we want to instrument.
 * This is done by injecting the ESM shim which proxies every property on the exported
 * module and registers the module with shimmer so instrumentation can be registered properly.
 *
 * Note: this autogenerated code _requires_ that the import have the file:// prefix!
 * Without it, Node.js throws an ERR_INVALID_URL error: you've been warned.
 *
 * @param {string} url the URL returned by the resolve chain
 * @param {string} specifier string identifier in an import statement or import() expression
 * @returns {string} source code rewritten to wrap with our esm-shim
 */
async function wrapEsmSource(url, specifier, esmShimPath) {
  const pkg = await import(url)
  const props = Object.keys(pkg)
  const trimmedUrl = fileURLToPath(url)

  return `
    import wrapModule from '${esmShimPath.href}'
    import * as _originalModule from '${url}'
    const _wrappedModule = wrapModule(_originalModule, '${specifier}', '${trimmedUrl}')
    ${props
      .map((propName) => {
        return `
    let _${propName} = _wrappedModule.${propName}
    export { _${propName} as ${propName} }`
      })
      .join('\n')}
  `
}
