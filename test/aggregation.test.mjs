import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { generateIndex, publishDirectory } from '../scripts/generate.mjs'

const own = { name: 'dsh-owned', version: '1.0.0', repository: 'https://github.com/example/owned', title: 'Owned' }
const sources = ['first', 'second'].map(id => ({ id, title: `${id} market`, url: `https://${id}.example/market/index.json`, homepage: `https://${id}.example/`, license: 'Upstream terms', licenseUrl: `https://${id}.example/terms` }))
const version = (v, source = { type: 'npm', registry: 'https://registry.npmjs.org/' }, dsh = '^0.2.1-rc.1') => ({ version: v, publishTimestamp: 100, source, engines: { dsh } })
const plugin = (name, versions = [version('1.0.0')]) => ({ name, author: `${name} author`, repository: { url: `https://github.com/example/${name}` }, versions })
const packument = { name: own.name, time: { '1.0.0': '2026-10-30T00:00:00Z' }, versions: { '1.0.0': { name: own.name, version: '1.0.0', author: 'Original author', repository: own.repository, engines: { dsh: '0.2.1-rc.5' }, dsh: { bundle: { patch: './patch.yml' } } } } }
const index = plugins => ({ format: 1, title: 'Fixture', plugins })

async function fixture(t, { upstreamSources = sources, first = index([plugin('dsh-shared')]), second = index([plugin('dsh-other')]), ...options } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'market-aggregation-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const configPath = path.join(dir, 'market.json'), outputPath = path.join(dir, 'dist', 'index.json')
  await writeFile(configPath, JSON.stringify({ title: 'Combined', plugins: [own], upstreamSources }))
  const payloads = new Map([[sources[0].url, first], [sources[1].url, second]])
  return { configPath, outputPath, attempts: 1, retryDelayMs: 0,
    fetchImpl: async url => Response.json(url.startsWith('https://registry.npmjs.org/') ? packument : payloads.get(url)), ...options }
}

async function output(paths) {
  return { index: parseMarketIndex(JSON.parse(await readFile(paths.outputPath, 'utf8')), 'https://combined.example/index.json'), report: JSON.parse(await readFile(path.join(path.dirname(paths.outputPath), 'sources.json'), 'utf8')) }
}

test('aggregates every source, merges all versions and keeps the curated same-version target and author', async t => {
  const paths = await fixture(t, {
    first: index([plugin('dsh-shared', [version('1.0.0'), version('2.0.0')]), plugin(own.name, [version('1.0.0', { type: 'npm', registry: 'https://different.example/' }, '*'), version('2.0.0')])]),
    second: index([plugin('dsh-shared', [version('3.0.0')]), plugin('dsh-other')]),
  })
  await generateIndex(paths)
  const result = await output(paths)
  assert.equal(result.index.plugins.length, 3)
  assert.deepEqual(result.index.plugins.find(p => p.name === 'dsh-shared').versions.map(v => v.version), ['3.0.0', '2.0.0', '1.0.0'])
  const curated = result.index.plugins.find(p => p.name === own.name)
  assert.equal(curated.author, 'Original author')
  assert.equal(curated.repository.url, own.repository)
  assert.equal(curated.versions.find(v => v.version === '1.0.0').engines.dsh, '0.2.1-rc.5')
  assert.equal(marketInstallTarget(own.name, curated.versions.find(v => v.version === '1.0.0')).registry, 'https://registry.npmjs.org/')
  assert.ok(result.report.conflicts.some(c => c.name === own.name && c.version === '1.0.0' && c.selected.sourceId === 'curated'))
})

test('namespaces declarations and preserves relative icons and immutable git installation targets', async t => {
  const git = { type: 'git', url: 'https://github.com/example/repo', commit: 'a'.repeat(40), path: 'packages/plugin' }
  const first = { ...index([{ ...plugin('dsh-shared', [version('1.0.0', git)]), icon: './icons/plugin.svg', metadata: { category: 'tools', labels: ['verified'], sortKeys: { stars: 4 } } }]), metadata: { categories: { tools: { title: 'Tools' } }, labels: { verified: { title: 'First claims verification' } }, sortKeys: { stars: { title: 'Stars', order: 'desc' } } } }
  const second = { ...index([{ ...plugin('dsh-other'), metadata: { category: 'tools', labels: ['verified'] } }]), metadata: { categories: { tools: { title: 'Other category' } }, labels: { verified: { title: 'Other claim' } } } }
  const paths = await fixture(t, { first, second })
  await generateIndex(paths)
  const result = await output(paths), shared = result.index.plugins.find(p => p.name === 'dsh-shared')
  assert.ok(shared, 'the configured upstream must be included')
  assert.equal(shared.icon, 'https://first.example/market/icons/plugin.svg')
  assert.deepEqual(marketInstallTarget(shared.name, shared.versions[0]), marketInstallTarget(shared.name, version('1.0.0', git)))
  assert.equal(shared.metadata.category, 'upstream:first:tools')
  assert.ok(shared.metadata.labels.includes('upstream:first:verified'))
  assert.ok(shared.metadata.labels.includes('source:first'))
  assert.equal(shared.metadata.sortKeys['upstream:first:stars'], 4)
  assert.equal(result.index.metadata.labels['upstream:second:verified'].title, 'second market · Other claim')
  assert.ok(result.index.metadata.labels['source:first'])
})

test('same-version conflicts retain a complete priority winner and report both unmodified alternatives', async t => {
  const first = index([plugin('dsh-shared', [version('1.0.0', { type: 'npm', registry: 'https://first-registry.example/' }, '0.2.1-rc.3')])])
  const second = index([plugin('dsh-shared', [version('1.0.0', { type: 'git', url: 'https://github.com/example/alternative', commit: 'b'.repeat(40) }, '0.2.1-rc.5')])])
  const paths = await fixture(t, { first, second })
  await generateIndex(paths)
  const result = await output(paths), selected = result.index.plugins.find(p => p.name === 'dsh-shared').versions[0]
  assert.deepEqual(selected, first.plugins[0].versions[0], 'source and engines must come from the same priority record')
  const conflict = result.report.conflicts.find(c => c.name === 'dsh-shared')
  assert.equal(conflict.selected.sourceId, 'first')
  assert.deepEqual(conflict.alternatives[0].record, second.plugins[0].versions[0])
})

test('invalid or unavailable upstreams fail the complete build and preserve every previous dist file', async t => {
  for (const failure of ['schema', 'http', 'json']) {
    const paths = await fixture(t)
    await mkdir(path.dirname(paths.outputPath))
    for (const file of ['index.json', 'sources.json', 'summary.json', 'index.html']) await writeFile(path.join(path.dirname(paths.outputPath), file), `old ${file}`)
    const original = paths.fetchImpl
    paths.fetchImpl = async url => url !== sources[1].url ? original(url) : failure === 'schema' ? Response.json({ format: 2 }) : failure === 'http' ? new Response('', { status: 503 }) : new Response('{')
    await assert.rejects(generateIndex(paths))
    for (const file of ['index.json', 'sources.json', 'summary.json', 'index.html']) assert.equal(await readFile(path.join(path.dirname(paths.outputPath), file), 'utf8'), `old ${file}`)
  }
})

test('duplicate source IDs, credential URLs and invalid source URLs fail before fetching', async t => {
  for (const upstreamSources of [[sources[0], sources[0]], [{ ...sources[0], id: 'curated' }], [{ ...sources[0], url: 'https://user:secret@example.com/index.json' }], [{ ...sources[0], url: 'file:///tmp/index.json' }]]) {
    let calls = 0
    const paths = await fixture(t, { upstreamSources, fetchImpl: async () => { calls++; return Response.json(packument) } })
    await assert.rejects(generateIndex(paths))
    assert.equal(calls, 0)
  }
})

test('upstream bodies have a bounded size and leave the old index and report intact', async t => {
  const paths = await fixture(t, { maxBytes: 1024 })
  const original = paths.fetchImpl
  paths.fetchImpl = async url => url === sources[0].url ? new Response(' '.repeat(2048)) : original(url)
  await mkdir(path.dirname(paths.outputPath))
  await writeFile(paths.outputPath, 'old index')
  await writeFile(path.join(path.dirname(paths.outputPath), 'sources.json'), 'old report')
  await assert.rejects(generateIndex(paths), /size|bytes|large/i)
  assert.equal(await readFile(paths.outputPath, 'utf8'), 'old index')
  assert.equal(await readFile(path.join(path.dirname(paths.outputPath), 'sources.json'), 'utf8'), 'old report')
})

test('the same source content produces deterministic index bytes and records snapshot hashes and provenance', async t => {
  const paths = await fixture(t)
  await generateIndex(paths)
  const before = await readFile(paths.outputPath, 'utf8')
  await generateIndex(paths)
  assert.equal(await readFile(paths.outputPath, 'utf8'), before)
  const result = await output(paths)
  assert.equal(result.report.sources.length, 3)
  assert.match(result.report.sources.find(s => s.id === 'first').sha256, /^[a-f0-9]{64}$/)
  assert.equal(result.report.plugins['dsh-shared'].versions['1.0.0'].sourceId, 'first')
})

test('version-specific verification claims do not follow another source newer version', async t => {
  const first = index([plugin('dsh-shared', [version('2.0.0')])])
  const second = { ...index([{ ...plugin('dsh-shared'), metadata: { labels: ['verified', 'capability'] } }]), metadata: { labels: { verified: { title: 'Install verified' }, capability: { title: 'Supports images' } } } }
  const paths = await fixture(t, { first, second })
  await generateIndex(paths)
  const result = await output(paths), shared = result.index.plugins.find(p => p.name === 'dsh-shared')
  assert.ok(!shared.metadata.labels.includes('upstream:second:verified'))
  assert.ok(shared.metadata.labels.includes('upstream:second:capability'))
  assert.ok(shared.metadata.labels.includes('source:second'))
  assert.deepEqual(result.report.plugins['dsh-shared'].listings.find(x => x.sourceId === 'second').versions.map(v => v.version), ['1.0.0'])
  assert.ok(result.report.suppressedClaims.some(x => x.name === 'dsh-shared' && x.label === 'upstream:second:verified'))
})

test('a same-version git verification claim cannot endorse the selected npm target', async t => {
  const first = index([plugin('dsh-markup', [version('0.2.0')])])
  const second = { ...index([{ ...plugin('dsh-markup', [version('0.2.0', { type: 'git', url: 'https://github.com/example/markup', commit: 'c'.repeat(40) })]), metadata: { labels: ['verified'] } }]), metadata: { labels: { verified: { title: 'Reviewed' } } } }
  const paths = await fixture(t, { first, second })
  await generateIndex(paths)
  const result = await output(paths), markup = result.index.plugins.find(p => p.name === 'dsh-markup')
  assert.ok(!markup.metadata.labels.includes('upstream:second:verified'))
  assert.equal(markup.versions[0].source.type, 'npm')
})

test('a failed final directory rename restores the complete previous output', async t => {
  const paths = await fixture(t), directory = path.dirname(paths.outputPath)
  await mkdir(directory)
  for (const file of ['index.json', 'sources.json', 'summary.json', 'index.html']) await writeFile(path.join(directory, file), `old ${file}`)
  await assert.rejects(publishDirectory(`${directory}.missing.tmp`, directory), { code: 'ENOENT' })
  for (const file of ['index.json', 'sources.json', 'summary.json', 'index.html']) assert.equal(await readFile(path.join(directory, file), 'utf8'), `old ${file}`)
})

test('timeout while reading an upstream body is bounded and does not publish partial output', async t => {
  const paths = await fixture(t, { timeoutMs: 20 })
  const original = paths.fetchImpl, keepAlive = setTimeout(() => {}, 1000)
  t.after(() => clearTimeout(keepAlive))
  paths.fetchImpl = async url => url === sources[0].url ? new Response(new ReadableStream({ start() {} })) : original(url)
  await assert.rejects(generateIndex(paths), /timeout/i)
  await assert.rejects(readFile(paths.outputPath), { code: 'ENOENT' })
})

test('publishing preserves unrelated sibling files and asset directories', async t => {
  const paths = await fixture(t), directory = path.dirname(paths.outputPath)
  await mkdir(path.join(directory, 'icons'), { recursive: true })
  await writeFile(path.join(directory, '.keep'), 'keep this file')
  await writeFile(path.join(directory, 'icons', 'custom.svg'), '<svg/>')
  await generateIndex(paths)
  assert.equal(await readFile(path.join(directory, '.keep'), 'utf8'), 'keep this file')
  assert.equal(await readFile(path.join(directory, 'icons', 'custom.svg'), 'utf8'), '<svg/>')
})

test('filesystem roots and workspace ancestors are rejected before fetching or file mutation', async t => {
  const paths = await fixture(t)
  for (const directory of [path.parse(paths.outputPath).root, process.cwd(), path.dirname(process.cwd()), os.homedir()]) {
    let calls = 0
    await assert.rejects(generateIndex({ ...paths, outputPath: path.join(directory, 'index.json'), fetchImpl: async () => { calls++; throw new Error('must not fetch') } }), /managed|output|root|ancestor/i)
    assert.equal(calls, 0)
  }
})

test('previous generated-file symlinks cannot redirect writes outside the managed output', async t => {
  const paths = await fixture(t), directory = path.dirname(paths.outputPath), outside = path.join(path.dirname(directory), 'do-not-overwrite.json')
  await mkdir(directory)
  await writeFile(outside, 'unrelated outside file')
  try { await symlink(outside, paths.outputPath, 'file') } catch (error) { if (error.code === 'EPERM') return t.skip('Creating file symlinks requires Windows developer privileges'); throw error }
  await generateIndex(paths)
  assert.equal(await readFile(outside, 'utf8'), 'unrelated outside file')
  assert.equal((await output(paths)).index.plugins.length, 3)
})

test('landing summary is small, matches the audit report and contains no per-plugin audit payload', async t => {
  const paths = await fixture(t)
  await generateIndex(paths)
  const { report } = await output(paths)
  const summary = JSON.parse(await readFile(path.join(path.dirname(paths.outputPath), 'summary.json'), 'utf8'))
  assert.deepEqual(summary.summary, report.summary)
  assert.equal(summary.indexSha256, report.indexSha256)
  assert.equal(summary.plugins, undefined)
  assert.equal(summary.conflicts, undefined)
  assert.ok(summary.sources.every(source => source.metadata === undefined && source.snapshots === undefined))
  assert.ok(JSON.stringify(summary).length < 16384)
  await assert.rejects(generateIndex({ ...paths, outputPath: path.join(path.dirname(paths.outputPath), 'summary.json') }), /companion/)
})
