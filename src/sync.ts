import { readFileSync, watch } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { input, select } from '@inquirer/prompts'
import { isVideo, loadAll, write } from './commands.js'
import { ext, folders, IGNORE, nearestPkg, rel, scan, searchFolder, type Result } from './files.js'
import { component, optimizeSvg, transformSvg } from './svg.js'
import { c, log, SkipError, UsageError } from './ui.js'
import { optimizeVideo } from './video.js'

export const inside = (parent: string, child: string): boolean => {
  const r = relative(parent, child)
  return !r.startsWith('..') && !isAbsolute(r)
}

// components: SVG → React 컴포넌트 폴더 ("componentOut", component 명령과 공유). null이면 컴포넌트 안 만듦
export interface Mirror { src: string; out: string; components: string | null }

// package.json "subayai": { "sync": { "dir", "out" }, "componentOut" }. sync는 첫 sync를 끝까지 진행해야 생기고, 있어야 --watch 가능
export function savedMirror(): { sync: Omit<Mirror, 'components'> | null; components: string | null } {
  const pkg = nearestPkg()
  const none = { sync: null, components: null }
  if (!pkg) return none
  try {
    const cfg = (JSON.parse(readFileSync(pkg, 'utf8')) as { subayai?: { sync?: { dir?: unknown; out?: unknown }; componentOut?: unknown } }).subayai
    const s = cfg?.sync
    const at = (p: string): string => resolve(dirname(pkg), p)
    return {
      sync: typeof s?.dir === 'string' && typeof s.out === 'string' ? { src: at(s.dir), out: at(s.out) } : null,
      components: typeof cfg?.componentOut === 'string' ? at(cfg.componentOut) : null,
    }
  } catch {
    return none // 깨진 package.json은 설정 없음으로
  }
}

export async function saveMirror({ src, out, components }: Mirror): Promise<void> {
  const pkg = nearestPkg()
  if (!pkg) throw new UsageError('No package.json found. sync saves the folders there.')
  const text = await readFile(pkg, 'utf8')
  const json = JSON.parse(text) as { subayai?: Record<string, unknown> }
  const posix = (p: string): string => relative(dirname(pkg), p).split(sep).join('/') || '.'
  const sync = { dir: posix(src), out: posix(out) }
  json.subayai = { ...json.subayai, sync, ...(components && { componentOut: posix(components) }) }
  await mkdir(out, { recursive: true })
  // 기존 들여쓰기 유지
  const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? 2
  await writeFile(pkg, JSON.stringify(json, null, indent) + '\n')
  log(c.yellow(`Saved "subayai": { "sync": { "dir": "${sync.dir}", "out": "${sync.out}" }${components ? `, "componentOut": "${posix(components)}"` : ''} } to ${rel(pkg)}.`))
  log(c.dim('Watch for changes: npx subayai sync --watch'))
}

// out이 src 안에 있는 건 허용 (sources/watch에서 out은 제외). 같거나 out이 src를 품으면 결과가 원본과 섞임
export function checkMirror(src: string, out: string): void {
  if (inside(out, src)) throw new UsageError(`--out can't be the image folder or contain it: ${rel(out)} / ${rel(src)}`)
}

// 원본 목록 (하위 폴더 포함). src 안에 있는 out은 빼기
export async function sources(dir: string, out: string, exts: readonly string[]): Promise<string[]> {
  return (await scan(dir, Infinity, exts, null)).filter((f) => !inside(out, f))
}

// 결과 폴더: 새로 만들기(이미지 폴더 바로 아래) 또는 기존 폴더 자동완성
export async function askOut(src: string): Promise<string> {
  const how = await select({
    message: 'Output folder',
    choices: [
      { value: 'new', name: `New folder       ${c.dim(`created inside ${rel(src)}/`)}` },
      { value: 'existing', name: `Existing folder  ${c.dim('search the project')}` },
    ],
  })
  if (how === 'new') {
    const name = await input({ message: `Folder name (inside ${rel(src)}/)`, validate: (s) => /^[^./\\][^/\\]*$/.test(s.trim()) || 'Enter a folder name (no slashes, no leading dot)' })
    return join(src, name.trim())
  }
  const pkg = nearestPkg()
  const dirs = await folders(pkg ? dirname(pkg) : process.cwd())
  return searchFolder('Output folder (type to filter)', dirs, (d) => (inside(d, src) ? { text: '', disabled: 'image folder or its parent' } : { text: '' }))
}

// SVG 컴포넌트 폴더: 프로젝트 안 기존 폴더에서만 선택
export async function askComponentOut(): Promise<string> {
  const pkg = nearestPkg()
  return searchFolder('Folder for SVG React components (type to filter)', await folders(pkg ? dirname(pkg) : process.cwd()), () => ({ text: '' }))
}

// SVG → 폴더별 <componentOut>/<folder>-graphics.tsx. 이미 있는 컴포넌트는 조용히 skip (출력·exit code에 안 섞이게)
// ponytail: 수정된 SVG는 기존 컴포넌트를 안 바꿈 (이름이 이미 있으면 skip). 필요해지면 export 블록 교체
export async function syncComponents(svgs: string[], componentOut: string, fresh = false): Promise<Result[]> {
  const groups = new Map<string, string[]>()
  for (const f of svgs) groups.set(dirname(f), [...(groups.get(dirname(f)) ?? []), f])
  const results: Result[] = []
  for (const group of groups.values()) results.push(...(await component(group, { webp: false, out: componentOut }, false, fresh)))
  return results.filter((r) => r.status !== 'skipped')
}

// src/a/b.png → out/a/b.webp. PNG → WebP, MOV → MP4, 나머지는 확장자 유지
const RENAME: Record<string, string> = { png: 'webp', mov: 'mp4' }
export function mirrorPath(src: string, out: string, file: string): string {
  const r = relative(src, file)
  const to = RENAME[ext(file)]
  return join(out, to ? `${r.slice(0, -extname(r).length)}.${to}` : r)
}

// svg: minify / 영상: (mov → mp4) + compress / 이미지·gif: compress (gif·webp는 애니메이션 유지)
function encode(file: string, output: string): Promise<void> {
  if (ext(file) === 'svg') return transformSvg(file, output, optimizeSvg)
  if (isVideo(file)) return optimizeVideo(file, output)
  return write(loadAll(file), ext(output), 'small', output)
}

// 결과 mtime을 원본 mtime에 맞춰 두고 다르면 다시 처리 (원본 수정, 더 옛날 파일로 덮어쓰기 모두 잡힘)
export async function stale(src: string, out: string, file: string): Promise<boolean> {
  const [a, b] = await Promise.all([stat(file).catch(() => null), stat(mirrorPath(src, out, file)).catch(() => null)])
  if (!a) return false // 그 사이 지워짐
  return !b || Math.abs(a.mtimeMs - b.mtimeMs) >= 1
}

export async function syncFile(src: string, out: string, file: string): Promise<Result> {
  const dest = mirrorPath(src, out, file)
  const tmp = join(dirname(dest), `.${basename(dest, extname(dest))}.subayai-tmp${extname(dest)}`)
  let before = 0
  try {
    const st = await stat(file)
    before = st.size
    await mkdir(dirname(dest), { recursive: true })
    // 포맷이 그대로면 압축 이득이 없을 때(더 큼 / SkipError) 원본 그대로. 포맷이 바뀌면(PNG, MOV) 결과 사용
    const same = ext(dest) === ext(file)
    await encode(file, tmp).catch((e: unknown) => {
      if (!(same && e instanceof SkipError)) throw e
    })
    if (same && ((await stat(tmp).catch(() => null))?.size ?? Infinity) >= before) await copyFile(file, tmp)
    await utimes(tmp, st.atimeMs / 1000, st.mtimeMs / 1000)
    await rename(tmp, dest)
    return { input: file, output: dest, before, after: (await stat(dest)).size, status: 'done' }
  } catch (e) {
    await rm(tmp, { force: true })
    return { input: file, before, status: 'error', reason: e instanceof Error ? e.message : String(e) }
  }
}

// 저장 1번에 이벤트 여러 개, 큰 파일은 복사 중에도 계속 옴 → 경로별로 300ms 조용해진 뒤 처리, 한 번에 하나씩
// ponytail: 원본 삭제/이름 변경은 결과에 반영 안 함 (옛 결과가 남음). 필요해지면 --prune
export function watchMirror({ src, out, components }: Mirror, exts: readonly string[], report: (r: Result) => void): Promise<never> {
  return new Promise((_, reject) => {
    const timers = new Map<string, NodeJS.Timeout>()
    let queue = Promise.resolve()
    const run = async (p: string): Promise<void> => {
      const st = await stat(p).catch(() => null)
      // 폴더째 옮겨 넣으면 폴더 이벤트 하나만 올 수 있음 → 폴더면 안을 전부 확인
      const files = st?.isDirectory() ? await sources(p, out, exts) : st?.isFile() && exts.includes(ext(p)) ? [p] : []
      for (const f of files) if (await stale(src, out, f)) report(await syncFile(src, out, f))
      if (components) for (const r of await syncComponents(files.filter((f) => ext(f) === 'svg'), components)) report(r)
    }
    watch(src, { recursive: true }, (_event, name) => {
      if (!name || name.split(sep).some((s) => s.startsWith('.') || IGNORE.has(s))) return
      const p = join(src, name)
      if (inside(out, p)) return // 자기 결과 (out이 src 안일 때)
      clearTimeout(timers.get(p))
      timers.set(p, setTimeout(() => {
        timers.delete(p)
        queue = queue.then(() => run(p)).catch((e: unknown) => log(c.red(e instanceof Error ? e.message : String(e))))
      }, 300))
    }).on('error', reject)
  })
}
