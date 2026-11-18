#!/usr/bin/env node
/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const fs = require('fs')
const path = require('path')
const { Command } = require('commander')

const Github = require('./github')
const git = require('./git-commands')

const program = new Command()
program.option('--dry-run', 'fetch and diff, but do not push a branch or open a PR')
program.option('--remote <remote>', 'remote to push the branch to', 'origin')

const UPSTREAM_URL =
  'https://raw.githubusercontent.com/aws/aws-sdk-js-v3/main/packages-internal/util-endpoints/src/lib/aws/partitions.json'
const SNAPSHOT_PATH = path.join(__dirname, '../lib/util/aws-partitions.json')
const DEFAULT_PARTITION_ID = 'aws'
const BASE_BRANCH = 'main'

/**
 * Checks the upstream AWS partitions.json for changes against our local
 * snapshot (lib/util/aws-partitions.json) and opens a PR when it drifts.
 *
 * To use this script you must set the following env vars:
 * GITHUB_TOKEN - api token to talk to Github API
 * GITHUB_USER - git user.name for the commit
 * GITHUB_EMAIL - git user.email for the commit
 *
 * `node ./bin/check-aws-partitions.js [--dry-run] [--remote <remote>]`
 */
async function run() {
  program.parse()
  const { dryRun, remote } = program.opts()

  logStep('Fetch upstream partitions.json')
  const upstream = await fetchUpstreamPartitions()

  logStep('Diff against local snapshot')
  const current = readSnapshot()
  const diff = diffPartitions(current, upstream)

  if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
    console.log('No partition changes detected.')
    return
  }

  console.log('Partition changes detected:', JSON.stringify(diff, null, 2))

  if (dryRun) {
    console.log('--dry-run set, skipping branch/commit/PR.')
    return
  }

  logStep('Branch creation')
  const branchName = `update-aws-partitions-${new Date().toISOString().slice(0, 10)}`
  await git.setUser(requireEnv('GITHUB_USER'), requireEnv('GITHUB_EMAIL'))
  await git.checkoutNewBranch(branchName)

  logStep('Write snapshot and commit')
  writeSnapshot(upstream)
  await git.addFiles([SNAPSHOT_PATH])
  await git.commit('fix: Updated AWS partition table from aws-sdk-js-v3')
  await git.pushToRemote(remote, branchName)

  logStep('Create pull request')
  const github = new Github('newrelic', 'node-newrelic')
  await github.createPR({
    head: branchName,
    base: BASE_BRANCH,
    title: 'fix: Update AWS partition table',
    body: formatPrBody(diff)
  })

  console.log('*** Full Run Successful ***')
}

/**
 * Fetches partitions.json from aws-sdk-js-v3 and reduces it to the
 * `{ id, regionRegex }` shape used by lib/util/aws-partitions.json, copied
 * verbatim and excluding the default `aws` partition (the fallback already
 * in aws-partition.js).
 *
 * AWS has moved this file's path before (it currently also lives, in a
 * slightly different form, under @aws-sdk/core), so every assumption this
 * makes about the response is validated explicitly and throws immediately
 * on mismatch — a 404, a restructured JSON body, a renamed/missing field,
 * or a regionRegex that doesn't compile as a RegExp should fail the CI job
 * loudly rather than write a silently wrong or incomplete snapshot and
 * still open a PR.
 *
 * @returns {Promise<Array<{id: string, regionRegex: string}>>}
 */
async function fetchUpstreamPartitions() {
  const res = await fetch(UPSTREAM_URL)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch partitions.json (${res.status} ${res.statusText}) from ${UPSTREAM_URL}. ` +
        'AWS may have moved the file — check the URL still exists in aws-sdk-js-v3.'
    )
  }

  const body = await res.json()
  if (!Array.isArray(body?.partitions) || body.partitions.length === 0) {
    throw new Error(
      `Unexpected response shape from ${UPSTREAM_URL}: expected a non-empty "partitions" array, got ` +
        `${JSON.stringify(body).slice(0, 200)}. AWS may have restructured this file.`
    )
  }

  const resolved = body.partitions
    .filter((p) => p.id !== DEFAULT_PARTITION_ID)
    .map((p) => {
      if (typeof p.id !== 'string' || !p.id) {
        throw new Error(
          `Partition entry missing a valid "id" field: ${JSON.stringify(p)}. ` +
            'AWS may have renamed this field — update this script.'
        )
      }
      if (typeof p.regionRegex !== 'string' || !p.regionRegex) {
        throw new Error(
          `Partition "${p.id}" is missing a valid "regionRegex" field: ${JSON.stringify(p)}. ` +
            'AWS may have renamed this field — update this script.'
        )
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(p.regionRegex)
      } catch (err) {
        throw new Error(`Partition "${p.id}" has a regionRegex that fails to compile: ${err.message}`)
      }
      return { id: p.id, regionRegex: p.regionRegex }
    })
    .sort((a, b) => a.id.localeCompare(b.id))

  if (resolved.length === 0) {
    throw new Error(
      `Found 0 non-default partitions in ${UPSTREAM_URL} after filtering out "${DEFAULT_PARTITION_ID}". ` +
        'AWS may have renamed the default partition id — update this script.'
    )
  }

  return resolved
}

/**
 * @param {Array<{id: string, regionRegex: string}>} current our committed snapshot
 * @param {Array<{id: string, regionRegex: string}>} upstream freshly fetched snapshot
 * @returns {{added: object[], removed: object[], changed: object[]}}
 */
function diffPartitions(current, upstream) {
  const currentById = new Map(current.map((p) => [p.id, p.regionRegex]))
  const upstreamById = new Map(upstream.map((p) => [p.id, p.regionRegex]))

  const added = upstream.filter((p) => !currentById.has(p.id))
  const removed = current.filter((p) => !upstreamById.has(p.id))
  const changed = upstream.filter(
    (p) => currentById.has(p.id) && currentById.get(p.id) !== p.regionRegex
  )

  return { added, removed, changed }
}

function formatAddedPartition(partition) {
  return `\`${partition.id}\` (\`${partition.regionRegex}\`)`
}

function formatRemovedPartition(partition) {
  return `\`${partition.id}\``
}

function formatChangedPartition(partition) {
  return `\`${partition.id}\` -> \`${partition.regionRegex}\``
}

/**
 * @param {{added: object[], removed: object[], changed: object[]}} diff the partition changes to describe
 * @returns {string} PR body describing what changed upstream
 */
function formatPrBody(diff) {
  const lines = [
    'Automated weekly check against [`partitions.json`](' + UPSTREAM_URL + ') in aws-sdk-js-v3.',
    ''
  ]
  if (diff.added.length) {
    const added = diff.added.map(formatAddedPartition).join(', ')
    lines.push(`**Added:** ${added}`)
  }
  if (diff.removed.length) {
    const removed = diff.removed.map(formatRemovedPartition).join(', ')
    lines.push(`**Removed:** ${removed}`)
  }
  if (diff.changed.length) {
    const changed = diff.changed.map(formatChangedPartition).join(', ')
    lines.push(`**Changed regex:** ${changed}`)
  }
  lines.push('', 'Please verify `lib/util/aws-partition.js` still behaves as expected before merging.')
  return lines.join('\n')
}

function readSnapshot() {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'))
}

function writeSnapshot(partitions) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(partitions, null, 2) + '\n')
}

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    stopOnError(new Error(`${name} is required`))
  }
  return value
}

function stopOnError(err) {
  if (err) {
    console.error(err)
  }

  console.log('Halting execution with exit code: 1')
  process.exit(1)
}

function logStep(step) {
  console.log(`\n ----- [Step]: ${step} -----\n`)
}

/*
 * Exports slightly differ for tests vs. Github Actions
 * this allows us to require the function without it executing for tests,
 * and executing via `node` cli in GHA
 */
if (require.main === module) {
  run().catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  module.exports = {
    fetchUpstreamPartitions,
    diffPartitions,
    formatPrBody
  }
}
