import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { INDEX_URL } from './metadata.mjs'

const namespace = (id, key) => `upstream:${id}:${key}`
const sortedEntries = object => Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const attributed = (source, title) => typeof title === 'string' ? `${source.title} · ${title}`
  : Object.fromEntries(Object.entries(title).map(([language, text]) => [language, `${source.title} · ${text}`]))
function versionClaim(sourceId, id, declaration) {
  if (sourceId === 'marketplace' && ['registry', 'linuxdo'].includes(id)) return false
  return /verif|review|sandbox|check|install|refus|compatible|compatibility|older.release|审查|校验|验证|实装|拒装|能装|兼容|旧版/i.test(`${id} ${JSON.stringify(declaration.title)}`)
}

/** Merge only officially parsed records. Never combine source/engines across versions. */
export function aggregateIndexes(ownIndex, upstreams, { indexUrl = INDEX_URL, curatedTitle = 'Curated npm pins' } = {}) {
  const sources = [{ id: 'curated', title: curatedTitle, url: indexUrl, index: ownIndex }, ...upstreams]
  const metadata = { categories: {}, labels: {}, sortKeys: {} }, packages = new Map(), conflicts = [], conflictByVersion = new Map(), suppressedClaims = []
  const provenance = Object.create(null)
  for (const source of sources) {
    const parsed = parseMarketIndex(source.index, source.url)
    metadata.labels[`source:${source.id}`] = { title: source.title }
    for (const group of ['categories', 'labels', 'sortKeys']) {
      for (const [key, declaration] of sortedEntries(parsed.metadata[group])) metadata[group][namespace(source.id, key)] = { ...declaration, title: attributed(source, declaration.title) }
    }
    for (const plugin of parsed.plugins) {
      let entry = packages.get(plugin.name)
      const values = plugin.metadata
      if (!entry) {
        entry = { plugin: { ...plugin, metadata: {
          ...(values.category === undefined ? {} : { category: namespace(source.id, values.category) }),
          keywords: [], labels: [], sortKeys: {},
        } }, versions: new Map(), claims: [] }
        packages.set(plugin.name, entry)
        provenance[plugin.name] = { metadataSourceId: source.id, sources: [], versions: {}, listings: [] }
      }
      const info = provenance[plugin.name]
      info.sources.push(source.id)
      info.listings.push({ sourceId: source.id, sourcePluginUrl: plugin.homepage ?? source.homepage ?? source.url, ...(plugin.icon === undefined ? {} : { icon: plugin.icon }), ...(plugin.author === undefined ? {} : { author: plugin.author }), ...(plugin.repository === undefined ? {} : { repository: plugin.repository }), metadata: plugin.metadata, versions: plugin.versions })
      entry.plugin.metadata.keywords.push(...values.keywords)
      entry.plugin.metadata.labels.push(`source:${source.id}`)
      for (const id of values.labels) {
        const label = namespace(source.id, id)
        if (versionClaim(source.id, id, parsed.metadata.labels[id])) entry.claims.push({ sourceId: source.id, label, versions: plugin.versions })
        else entry.plugin.metadata.labels.push(label)
      }
      for (const [key, value] of sortedEntries(values.sortKeys)) entry.plugin.metadata.sortKeys[namespace(source.id, key)] = value
      for (const record of plugin.versions) {
        const candidate = { sourceId: source.id, record, installTarget: marketInstallTarget(plugin.name, record) }
        const selected = entry.versions.get(record.version)
        if (!selected) {
          entry.versions.set(record.version, candidate)
          info.versions[record.version] = candidate
        } else if (!same(selected.record, record)) {
          const key = `${plugin.name}@${record.version}`
          let conflict = conflictByVersion.get(key)
          if (!conflict) {
            conflict = { name: plugin.name, version: record.version, selected, alternatives: [] }
            conflicts.push(conflict)
            conflictByVersion.set(key, conflict)
          }
          conflict.alternatives.push(candidate)
        }
      }
    }
  }
  const ownNames = ownIndex.plugins.map(plugin => plugin.name), ownSet = new Set(ownNames)
  const names = [...ownNames, ...[...packages.keys()].filter(name => !ownSet.has(name)).sort()]
  const index = parseMarketIndex({ format: 1, title: ownIndex.title, ...(ownIndex.description === undefined ? {} : { description: ownIndex.description }), metadata, plugins: names.map(name => {
    const entry = packages.get(name)
    for (const claim of entry.claims) {
      const covered = [...entry.versions.values()].every(selected => claim.versions.some(record => record.version === selected.record.version
        && same(marketInstallTarget(name, record), selected.installTarget) && same(record.engines, selected.record.engines)))
      if (covered) entry.plugin.metadata.labels.push(claim.label)
      else suppressedClaims.push({ name, sourceId: claim.sourceId, label: claim.label, sourceVersions: claim.versions.map(record => record.version), reason: 'Merged versions, install targets or engines are not completely covered by this source claim' })
    }
    return { ...entry.plugin, metadata: { ...entry.plugin.metadata,
      keywords: [...new Set(entry.plugin.metadata.keywords)].sort(), labels: [...new Set(entry.plugin.metadata.labels)].sort(),
    }, versions: [...entry.versions.values()].map(value => value.record) }
  }) }, indexUrl)
  for (const plugin of index.plugins) for (const record of plugin.versions) {
    const selected = packages.get(plugin.name).versions.get(record.version)
    if (!same(marketInstallTarget(plugin.name, record), selected.installTarget) || !same(record, selected.record)) throw new Error(`Aggregation changed install target or compatibility: ${plugin.name}@${record.version}`)
  }
  return { index, conflicts: conflicts.sort((a, b) => `${a.name}@${a.version}` < `${b.name}@${b.version}` ? -1 : 1), plugins: provenance, suppressedClaims,
    summary: { plugins: index.plugins.length, versions: index.plugins.reduce((sum, p) => sum + p.versions.length, 0), inputPlugins: sources.reduce((sum, s) => sum + s.index.plugins.length, 0), conflicts: conflicts.length, suppressedClaims: suppressedClaims.length } }
}
