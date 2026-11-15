import assert from 'node:assert/strict'
import test from 'node:test'
import { enableSnapshotAutoMerge, validateSnapshotPr } from '../scripts/auto-merge.mjs'
import { coauthor } from '../scripts/snapshot.mjs'

const repository = 'tangyixiao/dsh-plugin-market'
const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40)
function fixture() {
  return {
    pr: { number: 38, state: 'open', draft: false, user: { login: 'github-actions[bot]' },
      head: { repo: { full_name: repository }, ref: 'automation/market-sync', sha: headSha },
      base: { repo: { full_name: repository }, ref: 'main', sha: baseSha } },
    files: [{ filename: 'market-snapshot.json', status: 'modified' }],
    comparison: { merge_base_commit: { sha: baseSha }, behind_by: 0, ahead_by: 1 }
  }
}
function harness(data = fixture()) {
  const calls = []
  let reads = 0
  return { calls, gh(args) {
    calls.push(args)
    if (args[0] !== 'api') return ''
    const endpoint = args.at(-1)
    if (endpoint.endsWith('/git/ref/heads/main')) return JSON.stringify({ object: { sha: baseSha } })
    if (endpoint.includes('/pulls?')) return JSON.stringify([data.pr])
    if (endpoint.includes('/files?')) return JSON.stringify([data.files])
    if (endpoint.includes('/compare/')) return JSON.stringify(data.comparison)
    if (endpoint.endsWith('/pulls/38')) {
      reads++
      return JSON.stringify(reads > 1 && data.moved ? { ...data.pr, head: { ...data.pr.head, sha: 'c'.repeat(40) } } : data.pr)
    }
    throw new Error(`Unexpected call ${args}`)
  } }
}
const context = { repository, baseSha, ref: 'refs/heads/main', event: 'schedule' }

test('only same-repository, current-main, snapshot-only bot PRs qualify', () => {
  for (const status of ['added', 'modified']) {
    const f = fixture()
    f.files[0].status = status
    assert.equal(validateSnapshotPr(f.pr, f.files, f.comparison, repository, baseSha), headSha)
  }
  const invalid = [
    f => { f.pr.state = 'closed' }, f => { f.pr.draft = true },
    f => { f.pr.user.login = 'someone' }, f => { f.pr.head.repo.full_name = 'someone/fork' },
    f => { f.pr.base.repo.full_name = 'someone/other' }, f => { f.pr.head.ref = 'feature' },
    f => { f.pr.base.ref = 'other' }, f => { f.pr.base.sha = 'new-main' },
    f => { f.files = [] }, f => { f.files.push({ filename: 'market.json', status: 'modified' }) },
    f => { f.files[0].filename = 'market.json' }, f => { f.files[0].status = 'removed' },
    f => { f.files[0].status = 'renamed' }, f => { f.comparison.merge_base_commit.sha = 'old-main' },
    f => { f.comparison.behind_by = 1 }, f => { f.comparison.ahead_by = 0 }
  ]
  for (const mutate of invalid) {
    const f = fixture(); mutate(f)
    const h = harness(f)
    assert.throws(() => enableSnapshotAutoMerge(context, h.gh))
    assert.equal(h.calls.some(args => ['workflow', 'pr'].includes(args[0])), false, 'Rejected scope must not dispatch or merge')
  }
})

test('dispatches both required checks before enabling merge of the exact head with co-author credit', () => {
  const h = harness()
  assert.equal(enableSnapshotAutoMerge(context, h.gh), true)
  const writes = h.calls.filter(args => args[0] !== 'api')
  assert.deepEqual(writes.slice(0, 2).map(args => args[2]), ['publish.yml', 'repository.yml'])
  for (const args of writes.slice(0, 2)) assert.equal(args.at(-1), 'automation/market-sync')
  assert.deepEqual(writes[2].slice(0, 9), ['pr', 'merge', '38', '--repo', repository, '--auto', '--merge', '--match-head-commit', headSha])
  assert(writes[2].at(-1).endsWith(coauthor))
  assert(!writes[2].includes('--admin'))
})

test('a moving head cannot be armed and untrusted workflow contexts cannot call GitHub', () => {
  const f = fixture(); f.moved = true
  const h = harness(f)
  assert.throws(() => enableSnapshotAutoMerge(context, h.gh), /PR changed/)
  assert(!h.calls.some(args => args[0] === 'pr'))
  for (const override of [{ ref: 'refs/heads/automation/market-sync' }, { event: 'pull_request' }]) {
    const h = harness()
    assert.throws(() => enableSnapshotAutoMerge({ ...context, ...override }, h.gh))
    assert.deepEqual(h.calls, [])
  }
})

test('no open snapshot PR is a no-op', () => {
  const h = harness()
  assert.equal(enableSnapshotAutoMerge(context, args => args.at(-1).includes('/pulls?') ? '[]' : h.gh(args)), false)
  assert(!h.calls.some(args => args[0] !== 'api'))
})
