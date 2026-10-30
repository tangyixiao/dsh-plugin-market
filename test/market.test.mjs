import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

import { generateIndex } from '../scripts/generate.mjs'
import { buildMarketIndex } from '../scripts/metadata.mjs'

const indexUrl = 'https://tangyixiao.github.io/dsh-plugin-market/index.json'
const config = {
  title: { en: 'Tangyixiao DSH Market', zh: 'Tangyixiao DSH 插件市场' },
  plugins: [{
    name: 'dsh-zcode-plan-bridge',
    version: '0.5.2',
    repository: 'https://github.com/tangyixiao/dsh-zcode-plan-bridge',
    title: 'ZCode Plan Bridge',
  }],
}
const secondPlugin = {
  name: '@example/dsh-other-bundle',
  version: '1.2.3',
  repository: 'https://github.com/example/dsh-other-bundle',
  title: 'Second Bundle',
}

function packument(plugin = config.plugins[0]) {
  return {
    name: plugin.name,
    'dist-tags': { latest: '0.5.1', next: '0.6.0-rc.1' },
    versions: {
      '0.5.1': { name: plugin.name, version: '0.5.1' },
      '0.6.0-rc.1': { name: plugin.name, version: '0.6.0-rc.1' },
      [plugin.version]: {
        name: plugin.name,
        version: plugin.version,
        author: { name: 'kyle123740' },
        description: 'A ZCode provider published by the package author.',
        homepage: `${plugin.repository}#readme`,
        repository: { type: 'git', url: `git+${plugin.repository}.git` },
        keywords: ['dsh-plugin', 'zcode'],
        engines: { dsh: '>=0.1.5 <0.3.0-0 || ^0.2.1-rc.1' },
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      },
    },
    time: { [plugin.version]: '2026-10-30T13:25:25.484Z' },
  }
}

function registryMap(registry = packument()) {
  return new Map([['dsh-zcode-plan-bridge', registry]])
}

test('builds multiple configured bundles including scoped packages with exact independent version pins', () => {
  const multiple = { ...config, plugins: [config.plugins[0], secondPlugin] }
  let index
  assert.doesNotThrow(() => {
    index = parseMarketIndex(buildMarketIndex(new Map([
      ['@example/dsh-other-bundle', packument(secondPlugin)],
      ['dsh-zcode-plan-bridge', packument()],
    ]), multiple), indexUrl)
  })
  assert.deepEqual(index.plugins.map((plugin) => marketInstallTarget(plugin.name, plugin.versions[0])), [
    { spec: 'dsh-zcode-plan-bridge@0.5.2', registry: 'https://registry.npmjs.org/' },
    { spec: '@example/dsh-other-bundle@1.2.3', registry: 'https://registry.npmjs.org/' },
  ])
})

test('indexes only the configured stable release with published metadata and compatibility', () => {
  const registries = registryMap()
  registries.set('@example/unlisted-plugin', packument(secondPlugin))
  const index = parseMarketIndex(buildMarketIndex(registries, config), indexUrl)
  assert.equal(index.plugins.length, 1)
  const plugin = index.plugins[0]
  assert.equal(plugin.name, 'dsh-zcode-plan-bridge')
  assert.deepEqual(plugin.versions.map((version) => version.version), ['0.5.2'])
  assert.deepEqual(marketInstallTarget(plugin.name, plugin.versions[0]), {
    spec: 'dsh-zcode-plan-bridge@0.5.2',
    registry: 'https://registry.npmjs.org/',
  })
  assert.equal(plugin.author, 'kyle123740')
  assert.equal(plugin.description, 'A ZCode provider published by the package author.')
  assert.equal(plugin.homepage, 'https://github.com/tangyixiao/dsh-zcode-plan-bridge#readme')
  assert.deepEqual(plugin.repository, { url: 'https://github.com/tangyixiao/dsh-zcode-plan-bridge' })
  assert.equal(plugin.versions[0].publishTimestamp, 1793366725)
  assert.equal(plugin.versions[0].engines.dsh, '>=0.1.5 <0.3.0-0 || ^0.2.1-rc.1')
})

test('accepts the string author form without replacing the package author', () => {
  const registry = packument()
  registry.versions['0.5.2'].author = 'kyle123740'
  assert.equal(buildMarketIndex(registryMap(registry), config).plugins[0].author, 'kyle123740')
})

test('rejects registry data that cannot describe the configured published bundle', () => {
  const cases = [
    ['wrong registry name', (registry) => { registry.name = 'someone-elses-plugin' }, /registry package name/i],
    ['missing version', (registry) => { delete registry.versions['0.5.2'] }, /0\.5\.2.*not published/i],
    ['unpublished package', (registry) => { registry.time.unpublished = { time: '2026-10-31T00:00:00.000Z' } }, /unpublished/i],
    ['wrong manifest name', (registry) => { registry.versions['0.5.2'].name = 'someone-elses-plugin' }, /manifest name/i],
    ['wrong manifest version', (registry) => { registry.versions['0.5.2'].version = '0.5.1' }, /manifest version/i],
    ['private package', (registry) => { registry.versions['0.5.2'].private = true }, /public/i],
    ['deprecated package', (registry) => { registry.versions['0.5.2'].deprecated = 'Do not install' }, /deprecated/i],
    ['missing bundle', (registry) => { delete registry.versions['0.5.2'].dsh }, /dsh\.bundle\.patch/i],
    ['empty bundle patch', (registry) => { registry.versions['0.5.2'].dsh.bundle.patch = ' ' }, /dsh\.bundle\.patch/i],
    ['non-string bundle patch', (registry) => { registry.versions['0.5.2'].dsh.bundle.patch = {} }, /dsh\.bundle\.patch/i],
    ['wrong repository', (registry) => { registry.versions['0.5.2'].repository.url = 'https://github.com/other/repo' }, /repository/i],
  ]
  for (const [label, mutate, errorPattern] of cases) {
    const registry = packument()
    mutate(registry)
    assert.throws(() => buildMarketIndex(registryMap(registry), config), errorPattern, label)
  }
})

test('rejects invalid publication times instead of substituting the build time', () => {
  for (const timestamp of [undefined, 'not-a-date', -1, '1969-01-01T00:00:00.000Z']) {
    const registry = packument()
    registry.time['0.5.2'] = timestamp
    assert.throws(() => buildMarketIndex(registryMap(registry), config), /time|Timestamp/i)
  }
})

test('requires valid top-level DSH compatibility instead of silently declaring any host compatible', () => {
  for (const compatibility of [undefined, '', 'not a semver range', 'workspace:*']) {
    const registry = packument()
    registry.versions['0.5.2'].engines.dsh = compatibility
    registry.versions['0.5.2'].dsh.engines = { dsh: '^0.2.1' }
    assert.throws(() => buildMarketIndex(registryMap(registry), config), /engines\.dsh/i)
  }
})

test('rejects invalid names and preview or malformed pins in market configuration', () => {
  for (const override of [
    { name: 'Bad Package Name' },
    { version: '0.6.0-rc.1' },
    { version: 'latest' },
    { version: '01.2.3' },
    { version: undefined },
  ]) {
    const invalid = { ...config, plugins: [{ ...config.plugins[0], ...override }] }
    assert.throws(() => buildMarketIndex(registryMap(), invalid), /name|version|stable/i)
  }
})

async function fixturePaths(t, selectedConfig = config) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dsh-market-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = path.join(directory, 'market.json')
  const outputPath = path.join(directory, 'dist', 'index.json')
  await writeFile(configPath, JSON.stringify(selectedConfig))
  return { configPath, outputPath }
}

test('generator fetches public metadata and writes an index the official installer consumes', async (t) => {
  const paths = await fixturePaths(t)
  await generateIndex({
    ...paths,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://registry.npmjs.org/dsh-zcode-plan-bridge')
      assert.equal(options.headers['cache-control'], 'no-cache')
      assert.equal(options.headers.authorization, undefined)
      assert.equal(options.credentials, 'omit')
      assert.equal(options.redirect, 'error')
      assert.ok(options.signal instanceof AbortSignal)
      return Response.json(packument())
    },
    attempts: 1,
  })
  const index = parseMarketIndex(JSON.parse(await readFile(paths.outputPath, 'utf8')), indexUrl)
  assert.equal(index.plugins.length, 1)
  const plugin = index.plugins[0]
  assert.deepEqual(marketInstallTarget(plugin.name, plugin.versions[0]), {
    spec: 'dsh-zcode-plan-bridge@0.5.2',
    registry: 'https://registry.npmjs.org/',
  })
})

test('fetches only configured package names and percent-encodes scoped registry paths', async (t) => {
  const multiple = { ...config, plugins: [config.plugins[0], secondPlugin] }
  const paths = await fixturePaths(t, multiple)
  const requested = []
  await generateIndex({
    ...paths,
    attempts: 1,
    fetchImpl: async (url) => {
      requested.push(url)
      if (url === 'https://registry.npmjs.org/dsh-zcode-plan-bridge') return Response.json(packument())
      assert.equal(url, 'https://registry.npmjs.org/%40example%2Fdsh-other-bundle')
      return Response.json(packument(secondPlugin))
    },
  })
  assert.equal(requested.length, 2)
  const index = parseMarketIndex(JSON.parse(await readFile(paths.outputPath, 'utf8')), indexUrl)
  assert.deepEqual(index.plugins.map((plugin) => plugin.name), ['dsh-zcode-plan-bridge', '@example/dsh-other-bundle'])
})

test('rejects duplicate or invalid later entries before any fetch or output change', async (t) => {
  for (const second of [config.plugins[0], { ...secondPlugin, version: 'latest' }]) {
    const paths = await fixturePaths(t, { ...config, plugins: [config.plugins[0], second] })
    await mkdir(path.dirname(paths.outputPath))
    await writeFile(paths.outputPath, 'previous accepted output\n')
    let fetches = 0
    await assert.rejects(generateIndex({
      ...paths,
      attempts: 1,
      fetchImpl: async () => {
        fetches += 1
        return Response.json(packument())
      },
    }), /duplicates|version|stable/i)
    assert.equal(fetches, 0)
    assert.equal(await readFile(paths.outputPath, 'utf8'), 'previous accepted output\n')
  }
})

test('waits for a pinned version to propagate without falling back to stale latest', async (t) => {
  const paths = await fixturePaths(t)
  let responses = 0
  await generateIndex({
    ...paths,
    attempts: 3,
    retryDelayMs: 0,
    fetchImpl: async () => {
      responses += 1
      if (responses === 1) return new Response('Not found', { status: 404 })
      const registry = packument()
      if (responses === 2) delete registry.versions['0.5.2']
      return Response.json(registry)
    },
  })
  const index = parseMarketIndex(JSON.parse(await readFile(paths.outputPath, 'utf8')), indexUrl)
  assert.equal(responses, 3)
  assert.deepEqual(index.plugins[0].versions.map((version) => version.version), ['0.5.2'])
})

test('exhausted publication retries leave the previous output intact', async (t) => {
  const paths = await fixturePaths(t)
  await mkdir(path.dirname(paths.outputPath))
  await writeFile(paths.outputPath, 'previous accepted output\n')
  let responses = 0
  await assert.rejects(generateIndex({
    ...paths,
    attempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      responses += 1
      const registry = packument()
      delete registry.versions['0.5.2']
      return Response.json(registry)
    },
  }), /0\.5\.2.*not published/i)
  assert.equal(responses, 2)
  assert.equal(await readFile(paths.outputPath, 'utf8'), 'previous accepted output\n')
})

test('an invalid later package rejects the complete build without replacing previous output', async (t) => {
  const paths = await fixturePaths(t, { ...config, plugins: [config.plugins[0], secondPlugin] })
  await mkdir(path.dirname(paths.outputPath))
  await writeFile(paths.outputPath, 'previous accepted output\n')
  let responses = 0
  await assert.rejects(generateIndex({
    ...paths,
    attempts: 3,
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      responses += 1
      if (url === 'https://registry.npmjs.org/dsh-zcode-plan-bridge') return Response.json(packument())
      const registry = packument(secondPlugin)
      registry.versions['1.2.3'].engines.dsh = 'invalid'
      return Response.json(registry)
    },
  }), /engines\.dsh/i)
  assert.equal(responses, 2)
  assert.equal(await readFile(paths.outputPath, 'utf8'), 'previous accepted output\n')
})

test('a missing later package is retried without refetching or publishing the first package', async (t) => {
  const paths = await fixturePaths(t, { ...config, plugins: [config.plugins[0], secondPlugin] })
  await mkdir(path.dirname(paths.outputPath))
  await writeFile(paths.outputPath, 'previous accepted output\n')
  const fetches = []
  await assert.rejects(generateIndex({
    ...paths,
    attempts: 2,
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      fetches.push(url)
      if (url === 'https://registry.npmjs.org/dsh-zcode-plan-bridge') return Response.json(packument())
      return new Response('Not found', { status: 404 })
    },
  }), /1\.2\.3.*not published/i)
  assert.deepEqual(fetches, [
    'https://registry.npmjs.org/dsh-zcode-plan-bridge',
    'https://registry.npmjs.org/%40example%2Fdsh-other-bundle',
    'https://registry.npmjs.org/%40example%2Fdsh-other-bundle',
  ])
  assert.equal(await readFile(paths.outputPath, 'utf8'), 'previous accepted output\n')
})

test('non-publication HTTP failures fail instead of publishing a partial index', async (t) => {
  const paths = await fixturePaths(t)
  await assert.rejects(generateIndex({
    ...paths,
    attempts: 1,
    fetchImpl: async () => new Response('Unavailable', { status: 503 }),
  }), /503/)
  await assert.rejects(readFile(paths.outputPath), { code: 'ENOENT' })
})
