import { rename, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { renameInBrowser, type RenameItem } from './browser-rename.js'
import { COMMANDS, type Flags } from './commands.js'
import { ext, produce, readUserConfig, rel, saveUserConfig, type Result } from './files.js'
import { tty } from './ui.js'

const kebabCase = (s: string): string => s
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/[_\s]+/g, '-')
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-|-$/g, '')

async function created(file: string): Promise<number> {
  const s = await stat(file)
  return s.birthtimeMs || s.mtimeMs
}

interface Target { input: string; output: string }

async function optimizeRenamed(results: Result[]): Promise<void> {
  const cmd = COMMANDS.optimize
  if (!cmd || !('prepare' in cmd)) return
  const files = results.map((r) => r.output ?? r.input).filter((file) => cmd.inputs.includes(ext(file)))
  const job = files.length ? await cmd.prepare(files, { webp: false, percent: '100' }) : null
  if (!job) return
  for (const r of results) {
    const file = r.output ?? r.input
    if (!cmd.inputs.includes(ext(file))) continue
    const result = await produce(file, { suffix: job.suffix, outExt: job.outExt(file), replace: true, keepSmaller: false }, (out) => job.run(file, out))
    if (result.status === 'done') Object.assign(r, { output: result.output, after: result.after, status: 'done', reason: undefined })
    else if (result.status === 'error') Object.assign(r, { status: 'error', reason: `renamed to ${basename(file)}, optimize failed: ${result.reason ?? ''}` })
  }
}

export async function renameFiles(files: string[], _flags: Flags, dryRun: boolean): Promise<Result[]> {
  const dir = dirname(files[0] ?? '.')
  const base = kebabCase(basename(dir)) || 'file'
  const ordered = [...files].sort((a, b) => basename(a).localeCompare(b, undefined, { numeric: true }))
  let optimize = false
  let targets: Target[]

  if (tty.interactive) {
    const items: RenameItem[] = await Promise.all(ordered.map(async (file) => ({ name: basename(file), ext: extname(file), time: await created(file) })))
    const saved = (await readUserConfig()).renameMiddles
    const history = Array.isArray(saved) ? saved.filter((m): m is string => typeof m === 'string') : []
    const plan = await renameInBrowser(ordered, items, base, rel(dir), history)
    if (!plan) return []
    if (plan.middles.length) await saveUserConfig({ renameMiddles: [...new Set([...plan.middles, ...history])].slice(0, 300) })
    optimize = plan.optimize
    targets = ordered.map((input, i) => ({ input, output: join(dir, `${plan.names[i] ?? ''}${extname(input)}`) }))
  } else {
    targets = ordered.map((input, i) => ({ input, output: join(dir, `${base}-${i + 1}${extname(input)}`) }))
  }

  const results: Result[] = []
  for (const { input, output } of targets) {
    const before = (await stat(input)).size
    if (input === output) results.push({ input, output, before, after: before, status: 'skipped', reason: 'already named' })
    else results.push({ input, output, before, after: before, status: 'done' })
  }
  if (dryRun) return results

  const changed = targets.filter(({ input, output }) => input !== output)
  const temps = changed.map(({ input }, i) => join(dir, `.subayai-rename-${i}${extname(input)}`))
  for (let i = 0; i < changed.length; i++) await rename(changed[i]!.input, temps[i]!)
  for (let i = 0; i < changed.length; i++) await rename(temps[i]!, changed[i]!.output)
  if (optimize) await optimizeRenamed(results)
  return results
}
