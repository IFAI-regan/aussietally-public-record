import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex')
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('Unexpected public data fields')
}
function counts(value, minimum = 0) {
  for (const field of ['yes', 'no', 'total']) if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new Error('Invalid counts')
  if (value.total < minimum || value.yes + value.no !== value.total) throw new Error('Inconsistent or withheld counts')
}
export function validateSnapshot(record, issueId) {
  if (!uuid.test(record.id) || record.issue_id !== issueId || !uuid.test(issueId) || !Number.isFinite(Date.parse(record.created_at))) throw new Error('Invalid snapshot identity')
  if (typeof record.payload !== 'string' || Buffer.byteLength(record.payload) > 500_000 || hash(record.payload) !== record.sha256) throw new Error('Snapshot checksum mismatch')
  const payload = JSON.parse(record.payload)
  exactKeys(payload, ['schema_version','issue_id','question','is_demo','as_of','close_date','total','yes','no','tally_matches','groups','suppressed_dimensions'])
  if (payload.schema_version !== 3 || payload.issue_id !== issueId || payload.is_demo !== false || payload.tally_matches !== true || typeof payload.question !== 'string' || !Number.isFinite(Date.parse(payload.as_of))) throw new Error('Snapshot is not verified public result data')
  counts(payload)
  if (!Array.isArray(payload.groups) || !Array.isArray(payload.suppressed_dimensions)) throw new Error('Invalid groups')
  const dimensions = ['state','city','age','sex']
  for (const group of payload.groups) {
    exactKeys(group, ['dimension','label','total','yes','no'])
    if (!dimensions.includes(group.dimension) || typeof group.label !== 'string') throw new Error('Invalid group')
    counts(group, 50)
  }
  if (payload.suppressed_dimensions.some(d => !dimensions.includes(d))) throw new Error('Invalid withheld dimension')
  return payload
}
export async function saveExact(path, bytes) {
  try {
    if (await readFile(path, 'utf8') !== bytes) throw new Error('Refusing to overwrite a historical record')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await writeFile(path, bytes, { flag: 'wx' })
  }
}
export async function publish({ url, key, directory = '.', excluded = [] }) {
  const base = new URL(url)
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.supabase.co') || base.username || base.password) throw new Error('Expected a Supabase HTTPS project URL')
  const get = async path => {
    const response = await fetch(new URL(`/rest/v1/${path}`, base), { headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error(`Public data request failed (${response.status})`)
    const text = await response.text()
    if (Buffer.byteLength(text) > 5_000_000) throw new Error('Public response too large')
    const data = JSON.parse(text)
    if (!Array.isArray(data)) throw new Error('Expected public data array')
    return data
  }
  const snapshots = []
  for (let offset = 0; ; offset += 100) {
    const issues = await get(`public_issues?select=id,slug,is_dummy&is_dummy=eq.false&order=id&limit=100&offset=${offset}`)
    for (const issue of issues) {
      if (!uuid.test(issue.id) || issue.is_dummy !== false) throw new Error('Invalid public issue')
      // Launch fixtures are never presented as real public opinion.
      if (issue.slug === 'launch-vote-test' || excluded.includes(issue.id)) continue
      const rows = await get(`result_snapshots?select=id,issue_id,created_at,payload,sha256&issue_id=eq.${issue.id}&order=created_at.desc&limit=1`)
      if (!rows.length) continue
      const record = rows[0]
      validateSnapshot(record, issue.id)
      const folder = join(directory, 'snapshots', issue.id)
      await mkdir(folder, { recursive: true })
      await saveExact(join(folder, `${record.id}.json`), record.payload)
      await saveExact(join(folder, `${record.id}.sha256`), `${record.sha256}  ${record.id}.json\n`)
      snapshots.push({ id: record.id, issue_id: issue.id, sha256: record.sha256, created_at: record.created_at, path: `snapshots/${issue.id}/${record.id}.json` })
    }
    if (issues.length < 100) break
  }
  if (snapshots.length > 1000) throw new Error('Manifest capacity needs review')
  // Commit all files together. A failed run never updates the published branch.
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({ published_at: new Date().toISOString(), snapshots }, null, 2) + '\n')
  return snapshots.length
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SUPABASE_URL, SUPABASE_PUBLIC_KEY, SNAPSHOT_EXCLUDED_ISSUES = '' } = process.env
  if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) throw new Error('Read-only public connection settings are required')
  const count = await publish({ url: SUPABASE_URL, key: SUPABASE_PUBLIC_KEY, excluded: SNAPSHOT_EXCLUDED_ISSUES.split(',').filter(Boolean) })
  console.log(`Prepared ${count} public snapshot records`)
}
