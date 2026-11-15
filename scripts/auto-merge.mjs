import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { coauthor } from './snapshot.mjs'

export function validateSnapshotPr(pr, files, comparison, repository, baseSha) {
  assert.equal(pr.state, 'open', 'PR must be open')
  assert.equal(pr.draft, false, 'Draft PRs require review')
  assert.equal(pr.user.login, 'github-actions[bot]', 'PR must be created by the sync bot')
  assert.equal(pr.head.repo?.full_name, repository, 'Fork PRs require review')
  assert.equal(pr.base.repo.full_name, repository, 'Unexpected base repository')
  assert.equal(pr.head.ref, 'automation/market-sync', 'Unexpected sync branch')
  assert.equal(pr.base.ref, 'main', 'Unexpected base branch')
  assert.equal(files.length, 1, 'Only one snapshot file may change')
  assert.equal(files[0].filename, 'market-snapshot.json', 'Code or pin changes require review')
  assert(['added', 'modified'].includes(files[0].status), 'Snapshot must not be removed or renamed')
  assert.equal(comparison.merge_base_commit.sha, baseSha, 'Sync branch must include current main')
  assert.equal(comparison.behind_by, 0, 'Sync branch is behind main')
  assert(comparison.ahead_by > 0, 'Sync branch has no update')
  return pr.head.sha
}

export function enableSnapshotAutoMerge({ repository, baseSha, ref, event }, gh) {
  assert.equal(ref, 'refs/heads/main', 'Auto-merge may only run from main')
  assert(['push', 'schedule', 'workflow_dispatch'].includes(event), 'Unexpected workflow event')
  const api = endpoint => JSON.parse(gh(['api', `repos/${repository}/${endpoint}`]))
  assert.equal(api('git/ref/heads/main').object.sha, baseSha, 'Main changed during recording')
  const prs = api(`pulls?state=open&head=${repository.split('/')[0]}:automation/market-sync&base=main`)
  if (!prs.length) return false
  assert.equal(prs.length, 1, 'Expected one sync PR')
  const pr = api(`pulls/${prs[0].number}`)
  // PR base.sha and PR files can retain the creation-time base after main moves.
  // Compare against the current, independently verified main commit instead.
  // GitHub caps comparison files at 300; any multi-file result is rejected.
  const comparison = api(`compare/${baseSha}...${pr.head.sha}`)
  const headSha = validateSnapshotPr(pr, comparison.files, comparison, repository, baseSha)
  // GITHUB_TOKEN-created PR checks need approval. Dispatch BOTH required checks.
  // These branch workflows have read-only permissions and cannot deploy.
  for (const workflow of ['publish.yml', 'repository.yml']) {
    gh(['workflow', 'run', workflow, '--repo', repository, '--ref', pr.head.ref])
  }
  assert.equal(api(`pulls/${pr.number}`).head.sha, headSha, 'PR changed while checks were dispatched')
  assert.equal(api('git/ref/heads/main').object.sha, baseSha, 'Main changed while checks were dispatched')
  gh(['pr', 'merge', String(pr.number), '--repo', repository, '--auto', '--merge',
    '--match-head-commit', headSha, '--subject', `chore(sync): record deployed market indexes (#${pr.number})`,
    '--body', `Validated market snapshot. Required build and repository checks remain enforced.\n\n${coauthor}`])
  return true
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const enabled = enableSnapshotAutoMerge({ repository: process.env.GITHUB_REPOSITORY,
    baseSha: process.env.GITHUB_SHA, ref: process.env.GITHUB_REF, event: process.env.GITHUB_EVENT_NAME },
  args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
  console.log(enabled ? 'Requested both required checks and automatic merge of the guarded snapshot PR.' : 'No open snapshot PR; nothing to merge.')
}
