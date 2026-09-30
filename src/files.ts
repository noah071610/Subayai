import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { confirm, select, search } from '@inquirer/prompts'
import sharp from 'sharp'
import { LimitError, SkipError, UsageError, bytes, c, log, searchMany, tty, type Row } from './ui.js'

export const IGNORE = new Set(['node_modules', 'dist', 'build', 'out', 'coverage'])
const TMP = '.subayai-tmp'

export const ext = (file: string): string => extname(file).slice(1).toLowerCase()
export const rel = (file: string): string => relative(process.cwd(), file) || '.'

export const userConfigPath = join(homedir(), '.subayai', 'config.json')

export async function readUserConfig(): Promise<Record<string, unknown>> {
  return existsSync(userConfigPath) ? (JSON.parse(await readFile(userConfigPath, 'utf8')) as Record<string, unknown>) : {}
}

export async function saveUserConfig(patch: Record<string, unknown>): Promise<void> {
  const next = { ...(await readUserConfig()), ...patch }
  await mkdir(dirname(userConfigPath), { recursive: true, mode: 0o700 })
  await writeFile(userConfigPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  await chmod(userConfigPath, 0o600)
}

// package.json의 "subayai": { "dir": "..." }를 cwd부터 위로 탐색
export function configDir(): string | null {
  for (let d = process.cwd(); ; d = dirname(d)) {
    const pkg = join(d, 'package.json')
    if (existsSync(pkg)) {
      try {
        const json = JSON.parse(readFileSync(pkg, 'utf8')) as { subayai?: { dir?: unknown } }
        const dir = json.subayai?.dir
        if (typeof dir === 'string') return resolve(d, dir)
      } catch {
        // 깨진 package.json은 무시하고 계속 위로
      }
    }
    if (dirname(d) === d) return null
  }
}

// cwd부터 위로 가장 가까운 package.json 경로
export function nearestPkg(): string | null {
  for (let d = process.cwd(); ; d = dirname(d)) {
    const pkg = join(d, 'package.json')
    if (existsSync(pkg)) return pkg
    if (dirname(d) === d) return null
  }
}

export function localInstall(): boolean {
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules', 'subayai', 'package.json'))) return true
    if (dirname(d) === d) return false
  }
}

// depth 0 = start 폴더 자체. dot 폴더, node_modules 등은 건너뜀
export async function scan(start: string, maxDepth: number, exts: readonly string[], derived: RegExp | null): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth && !IGNORE.has(e.name)) await walk(p, depth + 1)
      } else if (e.isFile() && (exts.includes('*') || exts.includes(ext(e.name)))) {
        if (!derived?.test(basename(e.name, extname(e.name)))) out.push(p)
      }
    }
  }
  await walk(start, 0)
  return out.sort()
}

export interface Dims { width: number; height: number }

// EXIF orientation 5~8은 가로세로가 뒤집혀 저장됨
export async function dims(file: string): Promise<Dims> {
  const m = await sharp(file).metadata()
  const w = m.width ?? 0
  const h = m.height ?? 0
  return (m.orientation ?? 1) >= 5 ? { width: h, height: w } : { width: w, height: h }
}

const dimCache = new Map<string, string>()
export async function label(file: string, video: boolean): Promise<string> {
  let l = dimCache.get(file)
  if (l === undefined) {
    const size = bytes((await stat(file)).size)
    const d = video ? null : await dims(file).catch(() => null)
    l = d ? `${d.width}×${d.height}  ${size}` : size
    dimCache.set(file, l)
  }
  return l
}

export interface Target {
  root: string | null // --dir 또는 config
  exts: readonly string[]
  video: boolean
  derived: RegExp
  all: boolean // 폴더 선택(= --all) 허용 여부
  multi: boolean // picker에서 space로 여러 개 선택
}

// 인자로 파일명이 들어온 경우: 그대로 경로 → 이미지 폴더 → cwd 3단계 순으로 찾기
export async function findByName(name: string, t: Target): Promise<string> {
  const direct = resolve(name)
  if (existsSync(direct)) return direct
  const base = basename(name).toLowerCase()
  const pool = t.root ? await scan(t.root, Infinity, t.exts, null) : await scan(process.cwd(), 3, t.exts, null)
  const hits = pool.filter((f) => basename(f).toLowerCase() === base)
  if (hits.length === 0) throw new UsageError(`File not found: ${name}`)
  if (hits.length === 1 && hits[0]) return hits[0]
  if (!tty.interactive) throw new UsageError(`"${name}" matches ${hits.length} files. Pass a path instead:\n  ${hits.map(rel).join('\n  ')}`)
  return select({
    message: `Multiple files named "${name}". Which one?`,
    choices: await Promise.all(hits.map(async (f) => ({ name: `${rel(f)}  ${await label(f, t.video)}`, value: f }))),
  })
}

async function candidates(t: Target): Promise<string[]> {
  const files = t.root ? await scan(t.root, Infinity, t.exts, t.derived) : await scan(process.cwd(), 2, t.exts, t.derived)
  if (files.length === 0) {
    const where = t.root ? rel(t.root) : 'current folder (2 levels deep)'
    throw new UsageError(`No ${t.exts.includes('*') ? '' : `${t.exts.join('/')} `}files found in ${where}`)
  }
  return files
}

// 파일 또는 폴더 선택. 폴더를 고르면 --all과 동일 (확인 후 그 폴더 바로 아래 파일 전체)
export async function pickFile(t: Target): Promise<string[]> {
  if (!tty.interactive) throw new UsageError('No file given. Pass a file name, or --all with --dir.')
  const files = await candidates(t)
  const groups = new Map<string, string[]>()
  for (const f of files) groups.set(dirname(f), [...(groups.get(dirname(f)) ?? []), f])
  for (;;) {
    const source = async (term: string | undefined): Promise<Row[]> => {
      const q = (term ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      // ponytail: 공백 구분 단어가 전부 포함되면 매칭. fuzzy 필요하면 그때
      const match = (p: string) => q.every((w) => rel(p).toLowerCase().includes(w))
      const rows: Row[] = []
      for (const [d, fs] of groups) {
        if (t.all && fs.length > 1 && match(d)) rows.push({ key: `${d}/`, name: `${rel(d)}/  ${c.dim(`all ${fs.length} files`)}`, value: fs })
        for (const f of fs) if (match(f)) rows.push({ key: f, name: `${rel(f)}  ${await label(f, t.video)}`, value: [f] })
        if (rows.length >= 50) break
      }
      return rows.slice(0, 50)
    }
    const picked = t.multi
      ? await searchMany({ message: 'Pick files or folders (space to select several, type to filter)', pageSize: 12, source })
      : await search<string[]>({ message: t.all ? 'Pick a file or folder (type to filter)' : 'Pick a file (type to filter)', pageSize: 12, source })
    const first = picked[0]
    if (picked.length === 1 && first) return [first]
    // 여러 개는 무거운 작업이라 한 번 더 확인. No면 picker로 돌아감
    const dirs = new Set(picked.map((f) => dirname(f)))
    const where = dirs.size === 1 ? rel(dirname(first ?? '')) : `${dirs.size} folders`
    if (await confirm({ message: `Process ${picked.length} files in ${where}?`, default: true })) return picked
  }
}

// start 포함 하위 폴더 전부. dot 폴더, node_modules 등은 건너뜀
export async function folders(start: string): Promise<string[]> {
  const out = [start]
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith('.') || IGNORE.has(e.name)) continue
      const p = join(dir, e.name)
      out.push(p)
      await walk(p)
    }
  }
  await walk(start)
  return out.sort()
}

// 폴더 자동완성 picker. note가 문자열이면 선택 불가(이유 표시)
export async function searchFolder(message: string, dirs: string[], note: (d: string) => { text: string; disabled?: string }): Promise<string> {
  return search({
    message,
    pageSize: 12,
    source: async (term) => {
      const q = (term ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      return dirs
        .filter((d) => q.every((w) => rel(d).toLowerCase().includes(w)))
        .map((d) => {
          const n = note(d)
          return { name: `${rel(d)}/  ${c.dim(n.text)}`, value: d, disabled: n.disabled ?? false }
        })
    },
  })
}

// package.json에 dir이 없을 때: 프로젝트 안 모든 폴더에서 이미지 폴더를 고르고 "subayai": { "dir" }에 저장
export async function askImageDir(): Promise<string> {
  const pkg = nearestPkg()
  const base = pkg ? dirname(pkg) : process.cwd()
  const dir = await searchFolder('Pick your media folder (saved to package.json)', await folders(base), () => ({ text: '' }))
  const config = pkg ?? (localInstall() ? join(process.cwd(), 'package.json') : null)
  if (!config) return dir
  try {
    const text = existsSync(config) ? await readFile(config, 'utf8') : '{}'
    const json = JSON.parse(text) as { subayai?: Record<string, unknown> }
    json.subayai = { ...json.subayai, dir: relative(base, dir) || '.' }
    // 기존 들여쓰기 유지
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? 2
    await writeFile(config, JSON.stringify(json, null, indent) + '\n')
    log(c.yellow(`Saved "subayai": { "dir": "${json.subayai.dir}" } to ${rel(config)}.`))
  } catch {
    // 깨진 package.json은 저장만 건너뜀
  }
  return dir
}

// --all: 프로젝트 안 모든 폴더에서 선택 (설정된 dir과 무관, depth 제한 없음) → 그 폴더 바로 아래 파일 전체 (하위 폴더 X)
export async function pickFolder(t: Target): Promise<string[]> {
  if (!tty.interactive) {
    const root = t.root ?? process.cwd()
    const files = await scan(root, 0, t.exts, t.derived)
    if (files.length === 0) throw new UsageError(`No ${t.exts.join('/')} files in ${rel(root)}`)
    return files
  }
  const pkg = nearestPkg()
  const base = pkg ? dirname(pkg) : process.cwd()
  const groups = new Map<string, string[]>()
  for (const f of await scan(base, Infinity, t.exts, t.derived)) groups.set(dirname(f), [...(groups.get(dirname(f)) ?? []), f])
  const dir = await searchFolder('Pick a folder (type to filter)', await folders(base), (d) => {
    const n = groups.get(d)?.length ?? 0
    return n ? { text: `${n} file${n > 1 ? 's' : ''}` } : { text: '', disabled: 'no files' }
  })
  return groups.get(dir) ?? []
}

export interface Result {
  input: string
  output?: string
  before: number
  after?: number
  status: 'done' | 'skipped' | 'error'
  reason?: string
}

export interface OutOpts { suffix: string; outExt: string; replace: boolean; keepSmaller: boolean }

export function outputPath(input: string, o: OutOpts): string {
  const name = basename(input, extname(input))
  return join(dirname(input), `${name}${o.replace || !o.suffix ? '' : `_${o.suffix}`}.${o.outExt}`)
}

// 실행 1회 = 보관 폴더 1개 (로컬 시각, 2026-09-29_14-03-11)
const now = new Date()
now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
const RUN = now.toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')

// 원본 → <프로젝트 루트>/.subayai/<실행 시각>/<루트 기준 같은 경로>
// 프로젝트 밖 파일은 그 파일 폴더에 .subayai (다른 디스크면 rename 불가라서)
async function archive(input: string): Promise<void> {
  const pkg = nearestPkg()
  const root = pkg ? dirname(pkg) : process.cwd()
  const r = relative(root, input)
  const inside = !r.startsWith('..') && !isAbsolute(r)
  const store = join(inside ? root : dirname(input), '.subayai')
  const dest = join(store, RUN, inside ? r : basename(input))
  await mkdir(dirname(dest), { recursive: true })
  // 보관본이 git에 안 올라가게. 사용자 .gitignore는 안 건드림
  const ignore = join(store, '.gitignore')
  if (!existsSync(ignore)) await writeFile(ignore, '*\n')
  await rename(input, dest)
}

// 임시파일에 먼저 쓰고 성공한 뒤에만 원본 처리. replace면 원본은 .subayai/로 보관 후 결과가 원래 이름을 가져감
export async function produce(input: string, opts: OutOpts, run: (output: string) => Promise<void>): Promise<Result> {
  const dir = dirname(input)
  const name = basename(input, extname(input))
  const final = outputPath(input, opts)
  const before = (await stat(input)).size
  // macOS는 대소문자 무시 FS라 A.JPG == A.jpg
  if (final.toLowerCase() !== input.toLowerCase() && existsSync(final)) {
    return { input, before, status: 'skipped', reason: `${rel(final)} already exists` }
  }
  const tmp = join(dir, `.${name}${TMP}.${opts.outExt}`)
  try {
    await run(tmp)
    const after = (await stat(tmp)).size
    if (opts.keepSmaller && after >= before) {
      await rm(tmp, { force: true })
      return { input, before, after, status: 'skipped', reason: 'no size gain, original kept' }
    }
    if (opts.replace) await archive(input)
    await rename(tmp, final)
    return { input, output: final, before, after, status: 'done' }
  } catch (e) {
    await rm(tmp, { force: true })
    if (e instanceof LimitError) throw e
    if (e instanceof SkipError) return { input, before, status: 'skipped', reason: e.message }
    return { input, before, status: 'error', reason: e instanceof Error ? e.message : String(e) }
  }
}
