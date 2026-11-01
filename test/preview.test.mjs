import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { buildMarketIndex } from '../scripts/metadata.mjs'
import { generateIndex } from '../scripts/generate.mjs'

const own = { name: 'dsh-zcode-plan-bridge', version: '0.6.0-community.4', repository: 'https://github.com/example/bridge', title: 'Bridge Preview' }
const config = { title: { en: 'Explicit Preview', zh: '显式预览' }, description: 'Opt-in preview channel', allowPrerelease: true, indexUrl: 'https://market.example/preview/index.json', plugins: [own] }
function manifest(pin) { return { name: pin.name, version: pin.version, author: 'Original author', repository: { url: `git+${pin.repository}.git` }, main: './lib/index.js', engines: { dsh: '0.2.1-rc.5' }, dsh: { bundle: { patch: './cordis.patch.yml' } } } }
const published = pin => ({ name: pin.name, time: { [pin.version]: '2026-11-01T00:00:00Z' }, versions: { [pin.version]: manifest(pin) } })
const gitPin = { name: 'dsh-workbuddy-connect-community', version: '0.1.7-rc5.1', repository: 'https://github.com/example/workbuddy', title: 'WorkBuddy Preview', source: { type: 'git', url: 'https://github.com/example/workbuddy', commit: 'a'.repeat(40) } }
function gitEvidence(pin = gitPin) {
  return {
    release: { tag_name: `v${pin.version}`, draft: false, prerelease: true, published_at: '2026-11-01T00:00:00Z' },
    commit: { sha: pin.source.commit },
    tree: { truncated: false, tree: [{ path: 'package.json', type: 'blob' }, { path: 'cordis.patch.yml', type: 'blob' }, { path: 'lib/index.js', type: 'blob' }] },
    manifest: manifest(pin),
  }
}
async function fixture(t, selected = config) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'market-preview-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const configPath = path.join(dir, 'preview.market.json'), outputPath = path.join(dir, 'dist', 'preview', 'index.json')
  await writeFile(configPath, JSON.stringify(selected))
  return { configPath, outputPath, attempts: 1 }
}

test('exact preview pins require explicit opt-in and do not turn npm dist-tags into version selection', () => {
  const map = new Map([[own.name, published(own)]])
  assert.throws(() => buildMarketIndex(map, { ...config, allowPrerelease: false }), /stable|prerelease|preview/i)
  assert.throws(() => buildMarketIndex(map, { ...config, allowPrerelease: 'true' }), /allowPrerelease|boolean/i)
  const index = buildMarketIndex(map, config)
  assert.equal(index.description, 'Opt-in preview channel')
  assert.deepEqual(index.plugins[0].versions.map(v => v.version), ['0.6.0-community.4'])
  assert.throws(() => buildMarketIndex(map, { ...config, plugins: [{ ...own, version: 'community' }] }), /version|semver/i)
})

test('a preview Git release uses its published timestamp and fixed repository commit, not a fictitious npm source', () => {
  const selected = { ...config, plugins: [gitPin] }
  const index = buildMarketIndex(new Map([[gitPin.name, gitEvidence()]]), selected)
  assert.deepEqual(marketInstallTarget(gitPin.name, index.plugins[0].versions[0]), { spec: `git+https://github.com/example/workbuddy.git#${'a'.repeat(40)}` })
  assert.equal(index.plugins[0].versions[0].publishTimestamp, 1793491200)
  assert.equal(index.plugins[0].author, 'Original author')
})

test('Git tag identity, complete build files and manifest identity must agree before a release is indexed', () => {
  const cases = [
    evidence => { evidence.commit.sha = 'b'.repeat(40) },
    evidence => { evidence.release.draft = true },
    evidence => { evidence.release.published_at = null },
    evidence => { evidence.manifest.version = '0.1.6' },
    evidence => { evidence.tree.truncated = true },
    evidence => { evidence.tree.tree = evidence.tree.tree.filter(file => file.path !== 'lib/index.js') },
    evidence => { evidence.tree.tree = evidence.tree.tree.filter(file => file.path !== 'cordis.patch.yml') },
  ]
  for (const mutate of cases) {
    const evidence = gitEvidence(); mutate(evidence)
    assert.throws(() => buildMarketIndex(new Map([[gitPin.name, evidence]]), { ...config, plugins: [gitPin] }), /commit|release|publish|manifest|tree|entry|patch|file/i)
  }
})

test('preview generation retains upstream stable versions without touching the stable output', async t => {
  const upstream = { id: 'stable', title: 'Stable market', url: 'https://market.example/index.json' }
  const paths = await fixture(t, { ...config, upstreamSources: [upstream] })
  const stablePath = path.join(path.dirname(path.dirname(paths.outputPath)), 'index.json')
  await mkdir(path.dirname(stablePath), { recursive: true }); await writeFile(stablePath, 'stable channel stays identical')
  const stable = { format: 1, title: 'Stable market', plugins: [{ name: own.name, versions: [{ version: '0.5.2', publishTimestamp: 1793366725, source: { type: 'npm', registry: 'https://registry.npmjs.org/' } }] }] }
  await generateIndex({ ...paths, fetchImpl: async url => Response.json(url === upstream.url ? stable : published(own)) })
  const raw = await readFile(paths.outputPath, 'utf8'), index = parseMarketIndex(JSON.parse(raw), config.indexUrl)
  assert.deepEqual(index.plugins[0].versions.map(v => v.version), ['0.6.0-community.4', '0.5.2'])
  assert.equal(index.description, 'Opt-in preview channel')
  assert.equal(await readFile(stablePath, 'utf8'), 'stable channel stays identical')
  const report = JSON.parse(await readFile(path.join(path.dirname(paths.outputPath), 'sources.json'), 'utf8'))
  assert.equal(report.sources[0].url, 'https://market.example/preview/index.json')
  const summary = JSON.parse(await readFile(path.join(path.dirname(paths.outputPath), 'summary.json'), 'utf8'))
  assert.equal(summary.market.indexUrl, 'https://market.example/preview/index.json')
  assert.equal(summary.market.allowPrerelease, true)
})

test('Git generation reads only immutable public release evidence and leaves old output intact on tag mismatch', async t => {
  const selected = { ...config, plugins: [gitPin] }, paths = await fixture(t, selected), evidence = gitEvidence()
  const urls = {
    release: 'https://api.github.com/repos/example/workbuddy/releases/tags/v0.1.7-rc5.1',
    commit: 'https://api.github.com/repos/example/workbuddy/commits/v0.1.7-rc5.1',
    tree: `https://api.github.com/repos/example/workbuddy/git/trees/${'a'.repeat(40)}?recursive=1`,
    manifest: `https://raw.githubusercontent.com/example/workbuddy/${'a'.repeat(40)}/package.json`,
  }
  const payloads = new Map(Object.entries(urls).map(([key, url]) => [url, evidence[key]]))
  const fetchImpl = async url => { assert.ok(payloads.has(url), `unexpected public metadata request: ${url}`); return Response.json(payloads.get(url)) }
  await generateIndex({ ...paths, fetchImpl })
  const before = await readFile(paths.outputPath, 'utf8')
  assert.equal(JSON.parse(before).plugins[0].versions[0].source.type, 'git')
  evidence.commit.sha = 'b'.repeat(40)
  await assert.rejects(generateIndex({ ...paths, fetchImpl }), /commit/i)
  assert.equal(await readFile(paths.outputPath, 'utf8'), before)
})

test('GitHub read authentication is confined to generated Git metadata API requests', async t => {
  const previous = process.env.GITHUB_TOKEN
  process.env.GITHUB_TOKEN = 'test-read-token'
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous })
  const upstream = { id: 'external', title: 'External market', url: 'https://api.github.com/other-market/index.json' }
  const paths = await fixture(t, { ...config, plugins: [gitPin, own], upstreamSources: [upstream] }), evidence = gitEvidence()
  const payloads = new Map([
    ['https://api.github.com/repos/example/workbuddy/releases/tags/v0.1.7-rc5.1', evidence.release],
    ['https://api.github.com/repos/example/workbuddy/commits/v0.1.7-rc5.1', evidence.commit],
    [`https://api.github.com/repos/example/workbuddy/git/trees/${'a'.repeat(40)}?recursive=1`, evidence.tree],
    [`https://raw.githubusercontent.com/example/workbuddy/${'a'.repeat(40)}/package.json`, evidence.manifest],
    ['https://registry.npmjs.org/dsh-zcode-plan-bridge', published(own)],
    [upstream.url, { format: 1, title: 'Empty external market', plugins: [] }],
  ])
  await generateIndex({ ...paths, fetchImpl: async (url, options) => {
    assert.ok(payloads.has(url))
    const authenticated = ['https://api.github.com/repos/example/workbuddy/releases/tags/v0.1.7-rc5.1', 'https://api.github.com/repos/example/workbuddy/commits/v0.1.7-rc5.1', `https://api.github.com/repos/example/workbuddy/git/trees/${'a'.repeat(40)}?recursive=1`]
    assert.equal(options.headers.authorization, authenticated.includes(url) ? 'Bearer test-read-token' : undefined)
    return Response.json(payloads.get(url))
  } })
  assert.ok(!(await readFile(path.join(path.dirname(paths.outputPath), 'sources.json'), 'utf8')).includes('test-read-token'))
})

test('a Git metadata redirect stops before any redirected or downstream request and preserves accepted output', async t => {
  const paths = await fixture(t, { ...config, plugins: [gitPin] })
  await mkdir(path.dirname(paths.outputPath), { recursive: true }); await writeFile(paths.outputPath, 'previous preview')
  const requests = []
  await assert.rejects(generateIndex({ ...paths, fetchImpl: async (url, options) => {
    requests.push(url)
    assert.equal(options.redirect, 'error')
    assert.equal(options.credentials, 'omit')
    return new Response('', { status: 302, headers: { location: 'https://untrusted.example/collect' } })
  } }), /302/)
  assert.deepEqual(requests, ['https://api.github.com/repos/example/workbuddy/releases/tags/v0.1.7-rc5.1'])
  assert.equal(await readFile(paths.outputPath, 'utf8'), 'previous preview')
})
