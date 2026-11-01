import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { aggregateIndexes } from './aggregate.mjs'
import { buildMarketIndex, INDEX_URL, REGISTRY_URL, UnpublishedVersionError, validateConfig } from './metadata.mjs'

async function readJson(response, maxBytes, signal) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    void response.body?.cancel().catch(() => {})
    throw new Error(`Response exceeds ${maxBytes} bytes size limit`)
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Response has no JSON body')
  const chunks = []
  let bytes = 0, abort
  const aborted = new Promise((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }) })
  try {
    signal.throwIfAborted()
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted])
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes size limit`)
      chunks.push(value)
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally { signal.removeEventListener('abort', abort); try { reader.releaseLock() } catch {} }
  const buffer = Buffer.concat(chunks)
  return { value: JSON.parse(buffer.toString('utf8')), bytes, sha256: createHash('sha256').update(buffer).digest('hex'), fetchedAt: new Date().toISOString() }
}

function validateOutputDirectory(directory, protectedPaths = []) {
  const resolved = path.resolve(directory)
  for (const protectedPath of [path.parse(resolved).root, process.cwd(), os.homedir(), ...protectedPaths]) {
    const relative = path.relative(resolved, path.resolve(protectedPath))
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Output must be a managed directory, not a filesystem root or protected ancestor')
  }
  return resolved
}

function validateStage(stage, directory) {
  const resolved = path.resolve(stage)
  if (path.dirname(resolved) !== path.dirname(directory) || !path.basename(resolved).startsWith(`${path.basename(directory)}.`) || !resolved.endsWith('.tmp')) throw new Error('Staging directory must be a managed output sibling ending in .tmp')
  return resolved
}

/** Commit all generated files together; rollback a failed directory swap. */
export async function publishDirectory(stage, outputDirectory) {
  outputDirectory = validateOutputDirectory(outputDirectory)
  stage = validateStage(stage, outputDirectory)
  const backup = `${outputDirectory}.${randomUUID()}.backup`
  let previous = false
  try { await rename(outputDirectory, backup); previous = true } catch (error) { if (error.code !== 'ENOENT') throw error }
  try { await rename(stage, outputDirectory) }
  catch (error) { if (previous) await rename(backup, outputDirectory); throw error }
  if (previous) await rm(backup, { recursive: true, force: true })
}

/** Fetch every source, validate completely, then replace the complete dist. */
export async function generateIndex({
  configPath = fileURLToPath(new URL('../market.json', import.meta.url)),
  outputPath = fileURLToPath(new URL('../dist/index.json', import.meta.url)),
  fetchImpl = globalThis.fetch,
  attempts = Number(process.env.MARKET_FETCH_ATTEMPTS ?? 3),
  retryDelayMs = Number(process.env.MARKET_RETRY_DELAY_MS ?? 5000),
  timeoutMs = Number(process.env.MARKET_FETCH_TIMEOUT_MS ?? 15000),
  maxBytes = Number(process.env.MARKET_FETCH_MAX_BYTES ?? 33554432),
} = {}) {
  outputPath = path.resolve(outputPath)
  if (['sources.json', 'summary.json', 'index.html'].includes(path.basename(outputPath))) throw new Error('Output filename conflicts with a generated companion file')
  const directory = validateOutputDirectory(path.dirname(outputPath), [path.dirname(path.resolve(configPath))])
  try { if ((await lstat(directory)).isSymbolicLink()) throw new Error('Managed output directory must not be a symbolic link') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('MARKET_FETCH_ATTEMPTS must be an integer from 1 to 10')
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60000) throw new Error('MARKET_RETRY_DELAY_MS must be an integer from 0 to 60000')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('MARKET_FETCH_TIMEOUT_MS must be an integer from 1 to 60000')
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864) throw new Error('MARKET_FETCH_MAX_BYTES must be an integer from 1 to 67108864')
  const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')))
  const packuments = new Map(), snapshots = []
  async function fetchJson(url, check, publication) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const signal = AbortSignal.timeout(timeoutMs)
        const response = await fetchImpl(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' }, credentials: 'omit', redirect: 'error', signal })
        if (response.status === 404 && publication) throw new UnpublishedVersionError(`${publication.name}@${publication.version} is not published in the public registry yet (HTTP 404)`)
        if (!response.ok) {
          void response.body?.cancel().catch(() => {})
          const error = new Error(`Public source request failed for ${url}: HTTP ${response.status}`)
          error.retryable = !publication && (response.status === 429 || response.status >= 500)
          throw error
        }
        const snapshot = await readJson(response, maxBytes, signal)
        check(snapshot.value)
        return snapshot
      } catch (error) {
        const retryable = error instanceof UnpublishedVersionError || (!publication && (error.retryable || error.name === 'TimeoutError' || error instanceof TypeError))
        if (!retryable || attempt === attempts) throw error
        console.error(`${error.message}; retrying (${attempt}/${attempts})`)
        await delay(retryDelayMs)
      }
    }
  }
  for (const plugin of config.plugins) {
    const snapshot = await fetchJson(`${REGISTRY_URL}${encodeURIComponent(plugin.name)}`, value => buildMarketIndex(new Map([[plugin.name, value]]), { title: config.title, plugins: [plugin] }), plugin)
    packuments.set(plugin.name, snapshot.value)
    snapshots.push({ id: 'curated', name: plugin.name, url: `${REGISTRY_URL}${encodeURIComponent(plugin.name)}`, ...snapshot, value: undefined })
  }
  const upstreams = []
  for (const source of config.upstreamSources ?? []) {
    const snapshot = await fetchJson(source.url, value => parseMarketIndex(value, source.url))
    const parsed = parseMarketIndex(snapshot.value, source.url)
    upstreams.push({ ...source, index: parsed })
    snapshots.push({ ...source, ...snapshot, value: undefined, metadata: parsed.metadata, plugins: parsed.plugins.length, versions: parsed.plugins.reduce((sum, plugin) => sum + plugin.versions.length, 0) })
  }
  const ownIndex = buildMarketIndex(packuments, config), merged = aggregateIndexes(ownIndex, upstreams)
  const sources = [{ id: 'curated', title: 'Curated npm pins', url: INDEX_URL, pins: config.plugins.map(({ name, version }) => ({ name, version })), snapshots: snapshots.filter(s => s.id === 'curated') }, ...snapshots.filter(s => s.id !== 'curated')]
  const indexJson = `${JSON.stringify(merged.index, null, 2)}\n`
  const report = { format: 1, generatedAt: new Date().toISOString(), indexSha256: createHash('sha256').update(indexJson).digest('hex'), priority: sources.map(source => source.id), summary: merged.summary, sources, conflicts: merged.conflicts, plugins: merged.plugins, suppressedClaims: merged.suppressedClaims,
    verification: 'Schema validation and source aggregation only. No indexed plugin was installed or sandbox-tested by this market.' }
  const summary = { format: 1, generatedAt: report.generatedAt, indexSha256: report.indexSha256, summary: report.summary,
    sources: sources.map(source => Object.fromEntries(['id', 'title', 'url', 'homepage', 'license', 'licenseUrl', 'termsUrl', 'fetchedAt', 'sha256', 'bytes', 'plugins', 'versions', 'pins'].filter(key => source[key] !== undefined).map(key => [key, source[key]]))) }
  const stage = validateStage(`${directory}.${randomUUID()}.tmp`, directory)
  await mkdir(stage, { recursive: true })
  try {
    try { await cp(directory, stage, { recursive: true, force: true, verbatimSymlinks: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
    // Unlink copied generated-file symlinks before exclusive writes. Other assets
    // and siblings are carried over unchanged rather than removed with the backup.
    for (const name of [path.basename(outputPath), 'sources.json', 'summary.json', 'index.html']) await rm(path.join(stage, name), { force: true })
    await writeFile(path.join(stage, path.basename(outputPath)), indexJson, { encoding: 'utf8', flag: 'wx' })
    await writeFile(path.join(stage, 'sources.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await writeFile(path.join(stage, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await writeFile(path.join(stage, 'index.html'), await readFile(new URL('../public/index.html', import.meta.url)), { flag: 'wx' })
    await publishDirectory(stage, directory)
  } finally { await rm(stage, { recursive: true, force: true }) }
  const installTargets = merged.index.plugins.flatMap(plugin => plugin.versions.map(record => marketInstallTarget(plugin.name, record)))
  return { index: merged.index, report, installTargets, outputPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { outputPath, report } = await generateIndex()
    console.log(`Wrote ${outputPath}: ${report.summary.plugins} plugins, ${report.summary.versions} versions, ${report.summary.conflicts} conflicts recorded`)
  } catch (error) { console.error(`Market index generation failed: ${error.message}`); process.exitCode = 1 }
}
