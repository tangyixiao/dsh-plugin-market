import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

import { marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'

import { buildMarketIndex, REGISTRY_URL, UnpublishedVersionError, validateConfig } from './metadata.mjs'

/** Fetch public npm metadata, validate, then atomically replace the published index. */
export async function generateIndex({
  configPath = fileURLToPath(new URL('../market.json', import.meta.url)),
  outputPath = fileURLToPath(new URL('../dist/index.json', import.meta.url)),
  fetchImpl = globalThis.fetch,
  attempts = Number(process.env.MARKET_FETCH_ATTEMPTS ?? 3),
  retryDelayMs = Number(process.env.MARKET_RETRY_DELAY_MS ?? 5000),
  timeoutMs = Number(process.env.MARKET_FETCH_TIMEOUT_MS ?? 15000),
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) throw new Error('MARKET_FETCH_ATTEMPTS must be an integer from 1 to 10')
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 60000) throw new Error('MARKET_RETRY_DELAY_MS must be an integer from 0 to 60000')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('MARKET_FETCH_TIMEOUT_MS must be an integer from 1 to 60000')
  const config = validateConfig(JSON.parse(await readFile(configPath, 'utf8')))
  const packuments = new Map()
  for (const plugin of config.plugins) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetchImpl(`${REGISTRY_URL}${encodeURIComponent(plugin.name)}`, {
          headers: { accept: 'application/json', 'cache-control': 'no-cache' },
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.status === 404) {
          throw new UnpublishedVersionError(`${plugin.name}@${plugin.version} is not published in the public registry yet (HTTP 404)`)
        }
        if (!response.ok) throw new Error(`Public registry request failed for ${plugin.name}: HTTP ${response.status}`)
        const packument = await response.json()
        buildMarketIndex(new Map([[plugin.name, packument]]), { title: config.title, plugins: [plugin] })
        packuments.set(plugin.name, packument)
        break
      } catch (error) {
        if (!(error instanceof UnpublishedVersionError) || attempt === attempts) throw error
        console.error(`${error.message}; retrying (${attempt}/${attempts})`)
        await delay(retryDelayMs)
      }
    }
  }
  const index = buildMarketIndex(packuments, config)
  const installTargets = index.plugins.map((plugin) => marketInstallTarget(plugin.name, plugin.versions[0]))
  await mkdir(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, outputPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
  return { index, installTargets, outputPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { outputPath, installTargets } = await generateIndex()
    console.log(`Wrote ${outputPath}`)
    for (const target of installTargets) console.log(`${target.spec} from ${target.registry}`)
  } catch (error) {
    console.error(`Market index generation failed: ${error.message}`)
    process.exitCode = 1
  }
}
