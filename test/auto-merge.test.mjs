import assert from 'node:assert/strict'
import test from 'node:test'
import { enableSnapshotAutoMerge, PendingRunsError, snapshotCheckRuns, validateSnapshotPr } from '../scripts/auto-merge.mjs'
import { coauthor } from '../scripts/snapshot.mjs'

const repository = 'tangyixiao/dsh-plugin-market'
const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40)
function fixture() {
  return {
    pr: { number: 38, state: 'open', draft: false, user: { login: 'github-actions[bot]' },
      head: { repo: { full_name: repository }, ref: 'automation/market-sync', sha: headSha },
      base: { repo: { full_name: repository }, ref: 'main', sha: baseSha } },
    files: [{ filename: 'market-snapshot.json', status: 'modified' }],
    comparison: { merge_base_commit: { sha: baseSha }, behind_by: 0, ahead_by: 1 },
    runs: ['publish.yml', 'repository.yml'].map((workflow, i) => ({ id: 100 + i, path: `.github/workflows/${workflow}`,
      event: 'pull_request', head_sha: headSha, head_branch: 'automation/market-sync', head_repository: { full_name: repository },
      actor: { login: 'github-actions[bot]' }, pull_requests: [{ number: 38 }], conclusion: 'action_required' }))
  }
}
function harness(data = fixture()) {
  const calls = []
  let reads = 0, baseReads = 0
  return { calls, gh(args) {
    calls.push(args)
    if (args[0] !== 'api' || args.includes('POST')) return ''
    const endpoint = args.at(-1)
    if (endpoint.endsWith('/git/ref/heads/main')) {
      baseReads++
      return JSON.stringify({ object: { sha: baseReads > 1 && data.mainMoved ? 'new-main' : baseSha } })
    }
    if (endpoint.includes('/pulls?')) return JSON.stringify([data.pr])
    if (endpoint.includes('/actions/runs?')) return JSON.stringify({ workflow_runs: data.runs })
    if (endpoint.includes('/compare/')) return JSON.stringify({ ...data.comparison, files: data.files })
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
    f => { f.pr.base.ref = 'other' },
    f => { f.files = [] }, f => { f.files.push({ filename: 'market.json', status: 'modified' }) },
    f => { f.files[0].filename = 'market.json' }, f => { f.files[0].status = 'removed' },
    f => { f.files[0].status = 'renamed' }, f => { f.comparison.merge_base_commit.sha = 'old-main' },
    f => { f.comparison.behind_by = 1 }, f => { f.comparison.ahead_by = 0 }
  ]
  for (const mutate of invalid) {
    const f = fixture(); mutate(f)
    const h = harness(f)
    assert.throws(() => enableSnapshotAutoMerge(context, h.gh))
    assert.equal(h.calls.some(args => args[0] === 'pr' || args.includes('POST')), false, 'Rejected scope must not approve or merge')
  }
})

test('approves both actual PR check runs before enabling merge of the exact head with co-author credit', () => {
  const h = harness()
  assert.equal(enableSnapshotAutoMerge(context, h.gh), true)
  const writes = h.calls.filter(args => args[0] !== 'api' || args.includes('POST'))
  assert.deepEqual(writes.slice(0, 2), [100, 101].map(id => ['api', '--method', 'POST', `repos/${repository}/actions/runs/${id}/approve`]))
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

test('historical PR base metadata is accepted only when the current-main comparison is snapshot-only', () => {
  const f = fixture()
  f.pr.base.sha = 'creation-time-base'
  const h = harness(f)
  assert.equal(enableSnapshotAutoMerge(context, h.gh), true)
  assert(h.calls.some(args => args.at(-1).endsWith(`compare/${baseSha}...${headSha}`)))
  f.comparison.merge_base_commit.sha = 'creation-time-base'
  assert.throws(() => enableSnapshotAutoMerge(context, harness(f).gh), /current main/)
})

test('main movement during approval stops before requesting automatic merge', () => {
  const f = fixture(); f.mainMoved = true
  const h = harness(f)
  assert.throws(() => enableSnapshotAutoMerge(context, h.gh), /Main changed while/)
  assert(!h.calls.some(args => args[0] === 'pr'))
})

test('unrelated workflows, events, heads, branches, actors, repositories and PRs cannot be approved', () => {
  for (const mutate of [
    r => { r.path = '.github/workflows/other.yml' }, r => { r.event = 'workflow_dispatch' },
    r => { r.head_sha = 'other-head' }, r => { r.head_branch = 'other-branch' },
    r => { r.actor.login = 'someone' }, r => { r.head_repository.full_name = 'someone/fork' },
    r => { r.pull_requests = [{ number: 99 }] }
  ]) {
    const f = fixture(); mutate(f.runs[0])
    const h = harness(f)
    assert.throws(() => enableSnapshotAutoMerge(context, h.gh), PendingRunsError)
    assert(!h.calls.some(args => args.includes('POST') || args[0] === 'pr'))
  }
  const f = fixture()
  assert.deepEqual(snapshotCheckRuns([f.runs[0], { ...f.runs[0], id: 200 }, f.runs[1]], f.pr, repository).map(run => run.id), [200, 101])
})

test('already-started or successful PR checks are not approved again; an approval error stops auto-merge', () => {
  const f = fixture()
  f.runs[0].conclusion = 'success'; f.runs[1].conclusion = null
  const h = harness(f)
  assert.equal(enableSnapshotAutoMerge(context, h.gh), true)
  assert(!h.calls.some(args => args.includes('POST')))
  const failing = harness()
  assert.throws(() => enableSnapshotAutoMerge(context, args => {
    if (args.includes('POST')) throw new Error('Approval forbidden')
    return failing.gh(args)
  }), /Approval forbidden/)
  assert(!failing.calls.some(args => args[0] === 'pr'))
})

test('no open snapshot PR is a no-op', () => {
  const h = harness()
  assert.equal(enableSnapshotAutoMerge(context, args => args.at(-1).includes('/pulls?') ? '[]' : h.gh(args)), false)
  assert(!h.calls.some(args => args[0] !== 'api'))
})
