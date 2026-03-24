/*
 * Copyright 2022 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// eslint-disable-next-line n/no-unsupported-features/node-builtins
import { register } from 'node:module'
import { formatConfig } from './lib/subscribers/config.js'
// Exclusions must be regexes
const exclusions = [/@openai\/agents.*/]
const { instrumentations } = formatConfig()

register('@apm-js-collab/tracing-hooks/hook.mjs', import.meta.url, {
  data: { instrumentations }
})
register('import-in-the-middle/hook.mjs', import.meta.url, {
  data: { exclude: exclusions }
})
