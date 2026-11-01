import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

export const REGISTRY_URL = 'https://registry.npmjs.org/'
export const INDEX_URL = 'https://tangyixiao.github.io/dsh-plugin-market/index.json'

export class UnpublishedVersionError extends Error {}

/** Validate the complete selection before any package can be fetched or written. */
export function validateConfig(config) {
  if (!Array.isArray(config?.plugins) || config.plugins.length === 0) throw new Error('Market config needs a non-empty plugins array')
  if (config.allowPrerelease !== undefined && typeof config.allowPrerelease !== 'boolean') throw new Error('allowPrerelease must be a boolean')
  if (config.indexUrl !== undefined) {
    const url = new URL(config.indexUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('indexUrl must be HTTPS without credentials, query or fragment')
  }
  for (const plugin of config.plugins) {
    if (typeof plugin?.version !== 'string') throw new Error('Each configured version must be exact')
    if (config.allowPrerelease !== true && !/^\d+\.\d+\.\d+$/.test(plugin.version)) {
      throw new Error('Each configured version must be an exact stable version')
    }
    if (plugin.source?.type === 'git' && (plugin.source.url !== plugin.repository || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(plugin.repository))) throw new Error('Git pins require the matching canonical GitHub repository')
    if (plugin.source?.type === 'npm' && plugin.source.registry !== undefined && plugin.source.registry !== REGISTRY_URL) throw new Error('Curated npm pins use the public npm registry')
  }
  if (config.upstreamSources !== undefined && !Array.isArray(config.upstreamSources)) throw new Error('upstreamSources must be an array')
  const ids = new Set(['curated'])
  for (const source of config.upstreamSources ?? []) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(source?.id) || ids.has(source.id)) throw new Error('Each upstream source needs a unique id; curated is reserved')
    ids.add(source.id)
    if (typeof source.title !== 'string' || !source.title.trim()) throw new Error('Each upstream source needs a title')
    for (const field of ['url', 'homepage', 'licenseUrl', 'termsUrl']) {
      if (source[field] === undefined && field !== 'url') continue
      let url
      try { url = new URL(source[field]) } catch { throw new Error(`Invalid upstream ${field}`) }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`Upstream ${field} must be HTTPS without credentials or fragment`)
    }
  }
  // Use the official schema for names, exact SemVer, duplicate names, titles and
  // repository URLs as well as for the final index. No package metadata is implied.
  parseMarketIndex({
    format: 1,
    title: config.title,
    ...(config.description === undefined ? {} : { description: config.description }),
    plugins: config.plugins.map((plugin) => ({
      name: plugin.name,
      title: plugin.title,
      repository: { url: plugin.repository },
      versions: [{ version: plugin.version, publishTimestamp: 0, source: plugin.source ?? { type: 'npm', registry: REGISTRY_URL } }],
    })),
  }, config.indexUrl ?? INDEX_URL)
  return config
}

/** Public immutable source evidence for one explicitly selected Git release. */
export function gitPinUrls(selected) {
  const repository = selected.repository.slice('https://github.com/'.length), tag = encodeURIComponent(`v${selected.version}`)
  const prefix = selected.source.path ? `${selected.source.path}/` : ''
  return {
    release: `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    commit: `https://api.github.com/repos/${repository}/commits/${tag}`,
    tree: `https://api.github.com/repos/${repository}/git/trees/${selected.source.commit}?recursive=1`,
    manifest: `https://raw.githubusercontent.com/${repository}/${selected.source.commit}/${prefix}package.json`,
  }
}

function publishedManifest(manifest, selected, timestamp, source) {
  const { name, version } = selected
  if (manifest.name !== name) throw new Error('Published manifest name does not match the configured package')
  if (manifest.version !== version) throw new Error('Published manifest version does not match the configured version')
  if (manifest.private || manifest.deprecated) throw new Error('Published manifest must be public and non-deprecated')
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') throw new Error('Published manifest needs a dsh.bundle.patch string')
  const compatibility = manifest.engines?.dsh
  if (typeof compatibility !== 'string' || compatibility.trim() === '') throw new Error('Published manifest needs top-level engines.dsh')
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
      source,
      engines: { dsh: compatibility },
    }],
  }
}

function publishedPlugin(packument, selected) {
  const { name, version } = selected
  if (selected.source?.type === 'git') {
    if (packument?.commit?.sha !== selected.source.commit) throw new Error('Published Git tag does not resolve to the pinned commit')
    const release = packument.release
    if (release?.tag_name !== `v${version}` || release.draft !== false || release.prerelease !== version.includes('-')) throw new Error('Git release must be public and correctly marked as stable or prerelease')
    const plugin = publishedManifest(packument.manifest, selected, release.published_at, selected.source)
    if (!Array.isArray(packument.tree?.tree) || packument.tree.truncated !== false) throw new Error('Git tree must be complete')
    const files = new Set(packument.tree.tree.filter(entry => entry.type === 'blob').map(entry => entry.path))
    const prefix = selected.source.path ? `${selected.source.path}/` : ''
    for (const entry of ['package.json', packument.manifest.dsh.bundle.patch, packument.manifest.main, packument.manifest.exports?.['./client']].filter(value => value !== undefined)) {
      if (typeof entry !== 'string' || /(?:^|\/)\.\.(?:\/|$)|\\/.test(entry) || !files.has(prefix + entry.replace(/^\.\//, ''))) throw new Error('Git release is missing its declared package, patch or build entry file')
    }
    if (typeof packument.manifest.main !== 'string' || !packument.manifest.main) throw new Error('Git release needs a built main entry file')
    return plugin
  }
  if (packument?.name !== name) throw new Error('Registry package name does not match the configured package')
  if (packument.time?.unpublished) throw new Error('Package has been unpublished')
  const manifest = packument.versions?.[version]
  if (!manifest) throw new UnpublishedVersionError(`${name}@${version} is not published in the public registry yet`)
  return publishedManifest(manifest, selected, packument.time?.[version], { type: 'npm', registry: REGISTRY_URL })
}

/** Index only explicit pins; registry dist-tags and unconfigured packages are ignored. */
export function buildMarketIndex(packumentsByName, config) {
  validateConfig(config)
  return parseMarketIndex({
    format: 1,
    title: config.title,
    ...(config.description === undefined ? {} : { description: config.description }),
    plugins: config.plugins.map((plugin) => publishedPlugin(packumentsByName.get(plugin.name), plugin)),
  }, config.indexUrl ?? INDEX_URL)
}
