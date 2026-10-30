import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

export const REGISTRY_URL = 'https://registry.npmjs.org/'
export const INDEX_URL = 'https://tangyixiao.github.io/dsh-plugin-market/index.json'

export class UnpublishedVersionError extends Error {}

/** Validate the complete selection before any package can be fetched or written. */
export function validateConfig(config) {
  if (!Array.isArray(config?.plugins) || config.plugins.length === 0) throw new Error('Market config needs a non-empty plugins array')
  for (const plugin of config.plugins) {
    if (typeof plugin?.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(plugin.version)) {
      throw new Error('Each configured version must be an exact stable version')
    }
  }
  // Use the official schema for names, exact SemVer, duplicate names, titles and
  // repository URLs as well as for the final index. No package metadata is implied.
  parseMarketIndex({
    format: 1,
    title: config.title,
    plugins: config.plugins.map((plugin) => ({
      name: plugin.name,
      title: plugin.title,
      repository: { url: plugin.repository },
      versions: [{ version: plugin.version, publishTimestamp: 0, source: { type: 'npm', registry: REGISTRY_URL } }],
    })),
  }, INDEX_URL)
  return config
}

function publishedPlugin(packument, selected) {
  const { name, version } = selected
  if (packument?.name !== name) throw new Error('Registry package name does not match the configured package')
  if (packument.time?.unpublished) throw new Error('Package has been unpublished')
  const manifest = packument.versions?.[version]
  if (!manifest) throw new UnpublishedVersionError(`${name}@${version} is not published in the public registry yet`)
  if (manifest.name !== name) throw new Error('Published manifest name does not match the configured package')
  if (manifest.version !== version) throw new Error('Published manifest version does not match the configured version')
  if (manifest.private || manifest.deprecated) throw new Error('Published manifest must be public and non-deprecated')
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') throw new Error('Published manifest needs a dsh.bundle.patch string')
  const compatibility = manifest.engines?.dsh
  if (typeof compatibility !== 'string' || compatibility.trim() === '') throw new Error('Published manifest needs top-level engines.dsh')
  const timestamp = packument.time?.[version]
  const milliseconds = typeof timestamp === 'string' ? Date.parse(timestamp) : NaN
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('Published version has an invalid publication timestamp')
  const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  const repositoryUrl = repository?.replace(/^git\+/, '').replace(/\.git$/, '')
  if (repositoryUrl !== selected.repository) throw new Error('Published repository does not match the configured repository')
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name

  return {
    name: manifest.name,
    title: selected.title,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    ...(author === undefined ? {} : { author }),
    ...(manifest.homepage === undefined ? {} : { homepage: manifest.homepage }),
    repository: {
      url: repositoryUrl,
      ...(manifest.repository?.directory === undefined ? {} : { directory: manifest.repository.directory }),
    },
    metadata: { keywords: manifest.keywords ?? [] },
    versions: [{
      version,
      publishTimestamp: Math.floor(milliseconds / 1000),
      source: { type: 'npm', registry: REGISTRY_URL },
      engines: { dsh: compatibility },
    }],
  }
}

/** Index only explicit pins; registry dist-tags and unconfigured packages are ignored. */
export function buildMarketIndex(packumentsByName, config) {
  validateConfig(config)
  return parseMarketIndex({
    format: 1,
    title: config.title,
    plugins: config.plugins.map((plugin) => publishedPlugin(packumentsByName.get(plugin.name), plugin)),
  }, INDEX_URL)
}
