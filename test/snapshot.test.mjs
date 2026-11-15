import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { coauthor, createSnapshot, snapshotBody } from '../scripts/snapshot.mjs'

function fixture() {
  return Object.fromEntries(['stable', 'preview'].map(name => {
    const index = Buffer.from(`index-${name}`)
    return [name, { config: { upstreamSources: [{ id: 'first' }], plugins: [{ version: '1.0.0' }] }, index,
      summary: { indexSha256: createHash('sha256').update(index).digest('hex'), generatedAt: '2026-11-15T00:00:00Z',
        market: { allowPrerelease: name === 'preview' }, summary: { plugins: 2, versions: 3, conflicts: 1 },
        sources: [{ id: 'curated' }, { id: 'first', sha256: 'initial-input', fetchedAt: '2026-11-15T00:00:00Z' }] } }]
  }))
}

test('unchanged indexes and pins preserve prior evidence despite upstream timestamp/raw response churn', () => {
  const channels = fixture(), previous = createSnapshot(channels)
  channels.stable.summary.generatedAt = '2026-11-15T06:00:00Z'
  channels.stable.summary.sources[1] = { id: 'first', sha256: 'new-raw-input', fetchedAt: 'later' }
  assert.deepEqual(createSnapshot(channels, previous), previous)
  assert.equal(createSnapshot(channels).contentSha256, previous.contentSha256, 'An open PR with the same indexes must not get timestamp-only commits')
  channels.preview.config.plugins[0].version = '2.0.0'
  assert.notDeepEqual(createSnapshot(channels, previous).channels.preview, previous.channels.preview)
  assert.deepEqual(createSnapshot(channels, previous).channels.stable, previous.channels.stable)
})

test('changed index records fresh evidence; mixed, incomplete or wrong-channel output is rejected', () => {
  const channels = fixture(), previous = createSnapshot(channels)
  channels.stable.index = Buffer.from('new index')
  assert.throws(() => createSnapshot(channels, previous), /hash mismatch/)
  channels.stable.summary.indexSha256 = createHash('sha256').update(channels.stable.index).digest('hex')
  assert.notDeepEqual(createSnapshot(channels, previous).channels.stable, previous.channels.stable)
  channels.preview.summary.sources.pop()
  assert.throws(() => createSnapshot(channels), /incomplete sources/)
  channels.preview.summary.sources.push({ id: 'first' })
  channels.preview.summary.market.allowPrerelease = false
  assert.throws(() => createSnapshot(channels), /wrong channel/)
  assert.throws(() => createSnapshot({ stable: fixture().stable }), /Both channels/)
})

test('PR body ends with the verified human co-author trailer and identifies bot authorship', () => {
  const body = snapshotBody(createSnapshot(fixture()))
  assert.ok(body.endsWith(`\n\n${coauthor}\n`))
  assert.equal(body.match(/Co-authored-by:/g).length, 1)
  assert.match(body, /github-actions\[bot\]/)
  assert.match(body, /\| stable \| 2 \| 3 \| 1 \|/)
  assert.match(body, /\| preview \| 2 \| 3 \| 1 \|/)
})
