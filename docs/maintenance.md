# Maintenance, releases and resources

[Tangyixiao DSH Plugin Market](../README.md) adopts the [Tangyixiao Open Source Standard](https://github.com/tangyixiao/.github/blob/main/docs/standard.md) with project-specific choices in [.github/toss.json](../.github/toss.json).

## Maintenance path

- Weekly Dependabot updates are grouped for compatible minor/patch changes and limited to two open PRs per ecosystem. Major updates remain reviewable; no automatic merge or inactivity-based issue closure is configured.
- PR triage reads metadata and changed paths through the GitHub API. It does not check out PR code, run package scripts or access release credentials.
- Existing runtime checks remain separate from the repository/documentation checker. Action references are pinned, test jobs have timeouts and stale checks can cancel. Market deployment retains serialized publication.
- Labels, Discussions, private reporting, topics, security settings and branch rules are platform state. Their source files alone do not prove they are enabled or that a bot has run.

## Scheduled market sync and co-authorship

`Publish plugin market` runs every six hours (02:43, 08:43, 14:43 and 20:43 Asia/Shanghai), on pushes to `main`, and by manual dispatch. GitHub may delay scheduled runs. It checks repository policy, runs regressions, fetches every configured upstream, validates both channels and deploys only from `main`. A fetch, validation or build failure blocks deployment and the snapshot PR. Stable and preview pins remain explicit configuration; the bot does not select new npm tags or install indexed plugins.

After successful deployment, the separate `record-sync` job receives the validated snapshot as a job output. Only that job can write repository contents or PRs; its Actions permission explicitly dispatches both `publish.yml` (`build`) and `repository.yml` (`repository`) on the sync branch. GitHub places ordinary PR checks created by `GITHUB_TOKEN` in an approval-required state; explicit dispatch runs both required checks without manual approval. Non-main validation cannot deploy or write snapshot PRs. No new secret or personal access token is required. The repository must allow GitHub Actions to create pull requests and enable **Allow auto-merge**, while default workflow permissions remain read-only.

The bot stages only `market-snapshot.json` and maintains one `automation/market-sync` PR without force-pushing. Before requesting automatic merge, trusted code checked out from `main` verifies the bot author, same-repository branch, `main` target, current base ancestry and an added or modified snapshot as the sole changed file. It reads the current `main` reference and uses GitHub's commit comparison for the diff; PR metadata may retain the creation-time base. It dispatches both checks, rechecks the head and `main`, and requests `gh pr merge --auto --merge --match-head-commit`; required `build` and `repository` checks and the up-to-date branch rule remain enforced. Other PRs, code changes, plugin pins, drafts, forks and deleted/renamed snapshots require review.

The snapshot records each channel's exact index hash, configuration hash, source evidence and counts. Unchanged indexes and configurations retain their previous evidence timestamps; an already-current PR receives no duplicate commit. If `main` advances, the next successful deployment refreshes the bot branch's ancestry even when index hashes match, preserving its history with a normal push. A `main` change during recording or manual code edits on the bot branch stop recording rather than overwriting work. A scope or dispatch failure stops before requesting auto-merge. The snapshot is an audit record after deployment, not a frozen input for future builds.

Automated commits use `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` as author and end with the verified maintainer trailer:

```text
Co-authored-by: Tang Yixiao <115929632+tangyixiao@users.noreply.github.com>
```

The PR body ends with the same trailer. Preserve the bot author and human co-author on merge, then read back the default-branch commit as described in [Contributing](../CONTRIBUTING.md#dependency-updates-and-co-authorship--依赖更新与联合署名). Attribution does not by itself prove contribution-graph visibility or an achievement. Source licenses and original contributor credit remain intact.

To verify locally after building both channels, run `node scripts/snapshot.mjs` twice and confirm the second run leaves the snapshot unchanged. `npm test` also covers rejected PR scopes, head movement, both check dispatches and exact-head merge requests. To verify the deployed workflow, dispatch `publish.yml` on `main`, inspect all three jobs, both required branch checks, PR auto-merge/merge state, live stable/preview summary hashes, and the default-branch bot commit's author/trailer. If no index changed and no PR needs a current base, a successful no-change run correctly creates no commit. Disable **Allow auto-merge** to stop pending automatic merges, then revert this workflow change if needed.

References: [GitHub scheduled events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) · [Workflow triggering and GITHUB_TOKEN](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) · [Auto-merge settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository) · [Co-authored commits](https://docs.github.com/en/pull-requests/how-tos/commit-changes/creating-a-commit-with-multiple-authors).

## Release and distribution

The actual delivery type is **index**. Keep stable and preview versions distinct. Before publishing, verify the exact source, tests, package file list, runtime entries, version, license and notices. Then independently verify the registry/Release artifact, hashes, installation and activation where applicable. Do not publish an empty GitHub Package, container or application just to fill a feature.

Use existing release credentials and processes; this baseline does not provision new registry credentials or trusted-publisher access. Generated release-note categories are in [release.yml](../.github/release.yml). Describe upgrade, uninstall and recovery limits in the detailed guide. Restoring source or a version does not necessarily restore account/configuration state.

## Storage and cleanup

Reuse checkouts, dependencies and caches. Keep one task-owned scratch namespace, at least 10 GiB free, a 1 GiB growth review point, a 2 GiB ordinary optional-growth budget, one heavy local job and logs below 20 MiB. Explain a legitimate larger task budget before expansion. These are working agreements, not OS quotas.

Stop task-owned servers/watchers at completion. Check ownership, resolved paths, links, active consumers, ignored needed files and unique commits before removal. Do not delete unrelated work or shared caches. Bound CI diagnostic artifacts (normally 7 days); repository Actions retention is intended to be 14 days. Releases are durable deliverables and are not deleted by that policy.

## Documentation, privacy and project identity

The README is the user entry point; detailed guides preserve operational and compatibility detail. Feature cards describe real workflows and are not screenshots or progress measurements. Stars and Star History are external service-generated data and may be cached or unavailable; ordinary repository links remain usable.

Versioned documentation is authoritative; existing Wiki material is preserved rather than duplicated. Open issues and actual releases are the roadmap/status evidence. Do not create invented percentages, deadlines, sponsor destinations, product endorsements or security certifications. Asset licenses and attribution are separate from the original software license.
