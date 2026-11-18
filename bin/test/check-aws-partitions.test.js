/*
 * Copyright 2026 New Relic Corporation. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert')
const sinon = require('sinon')

const { fetchUpstreamPartitions, diffPartitions, formatPrBody } = require('../check-aws-partitions')

function stubFetch(status, body) {
  return sinon.stub(global, 'fetch').resolves({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Not Found',
    json: async () => body
  })
}

test('fetchUpstreamPartitions', async (t) => {
  t.afterEach(() => sinon.restore())

  await t.test('throws when the HTTP response is not ok', async () => {
    stubFetch(404, {})
    await assert.rejects(fetchUpstreamPartitions(), /Failed to fetch partitions\.json \(404/)
  })

  await t.test('throws when the response has no partitions array', async () => {
    stubFetch(200, { somethingElse: true })
    await assert.rejects(fetchUpstreamPartitions(), /expected a non-empty "partitions" array/)
  })

  await t.test('throws when partitions is an empty array', async () => {
    stubFetch(200, { partitions: [] })
    await assert.rejects(fetchUpstreamPartitions(), /expected a non-empty "partitions" array/)
  })

  await t.test('throws when a non-default entry is missing "id"', async () => {
    stubFetch(200, { partitions: [{ id: 'aws' }, { regionRegex: '^cn\\-\\w+\\-\\d+$' }] })
    await assert.rejects(fetchUpstreamPartitions(), /missing a valid "id" field/)
  })

  await t.test('throws when a non-default entry is missing "regionRegex"', async () => {
    stubFetch(200, { partitions: [{ id: 'aws' }, { id: 'aws-cn' }] })
    await assert.rejects(fetchUpstreamPartitions(), /"aws-cn" is missing a valid "regionRegex" field/)
  })

  await t.test('throws when a regionRegex fails to compile', async () => {
    stubFetch(200, {
      partitions: [{ id: 'aws' }, { id: 'aws-cn', regionRegex: '^cn-[\\w+-\\d+$' }]
    })
    await assert.rejects(fetchUpstreamPartitions(), /"aws-cn" has a regionRegex that fails to compile/)
  })

  await t.test('throws when filtering out the default partition leaves nothing', async () => {
    stubFetch(200, { partitions: [{ id: 'aws', regionRegex: '^(us|eu)\\-\\w+\\-\\d+$' }] })
    await assert.rejects(fetchUpstreamPartitions(), /Found 0 non-default partitions/)
  })

  await t.test('resolves the non-default partitions, sorted by id', async () => {
    stubFetch(200, {
      partitions: [
        { id: 'aws', regionRegex: '^(us|eu)\\-\\w+\\-\\d+$' },
        { id: 'aws-us-gov', regionRegex: '^us\\-gov\\-\\w+\\-\\d+$' },
        { id: 'aws-cn', regionRegex: '^cn\\-\\w+\\-\\d+$' }
      ]
    })
    const resolved = await fetchUpstreamPartitions()
    assert.deepEqual(resolved, [
      { id: 'aws-cn', regionRegex: '^cn\\-\\w+\\-\\d+$' },
      { id: 'aws-us-gov', regionRegex: '^us\\-gov\\-\\w+\\-\\d+$' }
    ])
  })
})

test('diffPartitions', async (t) => {
  const current = [
    { id: 'aws-cn', regionRegex: '^cn\\-\\w+\\-\\d+$' },
    { id: 'aws-us-gov', regionRegex: '^us\\-gov\\-\\w+\\-\\d+$' }
  ]

  await t.test('reports no changes when snapshots match', () => {
    const diff = diffPartitions(current, current)
    assert.deepEqual(diff, { added: [], removed: [], changed: [] })
  })

  await t.test('reports an added partition', () => {
    const upstream = [...current, { id: 'aws-eusc', regionRegex: '^eusc\\-(de)\\-\\w+\\-\\d+$' }]
    const diff = diffPartitions(current, upstream)
    assert.deepEqual(diff.added, [{ id: 'aws-eusc', regionRegex: '^eusc\\-(de)\\-\\w+\\-\\d+$' }])
    assert.deepEqual(diff.removed, [])
    assert.deepEqual(diff.changed, [])
  })

  await t.test('reports a removed partition', () => {
    const upstream = [current[0]]
    const diff = diffPartitions(current, upstream)
    assert.deepEqual(diff.removed, [current[1]])
  })

  await t.test('reports a changed regex', () => {
    const upstream = [{ id: 'aws-cn', regionRegex: '^cn\\-\\w+\\-\\d+\\-\\w+$' }, current[1]]
    const diff = diffPartitions(current, upstream)
    assert.deepEqual(diff.changed, [{ id: 'aws-cn', regionRegex: '^cn\\-\\w+\\-\\d+\\-\\w+$' }])
  })
})

test('formatPrBody', async (t) => {
  await t.test('describes an added partition', () => {
    const body = formatPrBody({
      added: [{ id: 'aws-eusc', regionRegex: '^eusc\\-(de)\\-\\w+\\-\\d+$' }],
      removed: [],
      changed: []
    })
    assert.match(body, /\*\*Added:\*\* `aws-eusc` \(`\^eusc\\-\(de\)\\-\\w\+\\-\\d\+\$`\)/)
  })

  await t.test('describes a removed partition', () => {
    const body = formatPrBody({ added: [], removed: [{ id: 'aws-iso-f' }], changed: [] })
    assert.match(body, /\*\*Removed:\*\* `aws-iso-f`/)
  })

  await t.test('describes a changed regex', () => {
    const body = formatPrBody({
      added: [],
      removed: [],
      changed: [{ id: 'aws-cn', regionRegex: '^cn\\-\\w+\\-\\d+\\-\\w+$' }]
    })
    assert.match(body, /\*\*Changed regex:\*\* `aws-cn` -> `\^cn\\-\\w\+\\-\\d\+\\-\\w\+\$`/)
  })
})
