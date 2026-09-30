#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { confirm, select } from '@inquirer/prompts'
import { COMMANDS, DERIVED, isVideo, type Command, type Flags } from './commands.js'
import { askImageDir, configDir, ext, findByName, label, localInstall, nearestPkg, outputPath, pickFile, pickFolder, produce, rel, scan, type Result, type Target } from './files.js'
import { askComponentOut, askOut, checkMirror, mirrorPath, saveMirror, savedMirror, sources, stale, syncComponents, syncFile, watchMirror, type Mirror } from './sync.js'
import { UsageError, bytes, c, log, tty } from './ui.js'

const HELP = `${c.bold('subayai')} - dead-simple image, SVG & video tasks

Usage
  npx subayai <command> [file] [flags]
  npx subayai <command> --all [--dir <folder>] [flags]
  npx subayai svg <recolor|responsive> [file] [flags]
  npx subayai merge video [--dir <folder>]

Commands
${Object.entries(COMMANDS)
  .map(([name, cmd]) => `  ${name.padEnd(16)}${cmd.summary}${cmd.flags ? `\n  ${''.padEnd(16)}${c.dim(cmd.flags)}` : ''}`)
  .join('\n')}

Common flags
  --all             Pick a folder and process every file in it
                    (without a saved image folder, asks for it once and saves it to package.json)
  --dir <folder>    Image folder (overrides package.json "subayai": { "dir": "..." })
  --watch           sync only: keep running and sync every change (after the first sync)
  -y, --yes         Replace the original (original is kept in .subayai/ at the project root)
  --dry-run         Show what would happen, change nothing
  --json            Machine-readable output, never prompts
  -h, --help        Show this help

Without a file name, an interactive picker opens. Pick a folder to process all files in it.
In non-interactive mode (no TTY or --json), every value must be passed as a flag.`

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const worker = async (): Promise<void> => {
    for (let item = items[i++]; item !== undefined; item = items[i++]) await fn(item)
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
}

// 실행 직전 마지막 질문. 기본값은 안전한 No
async function askReplace(): Promise<boolean> {
  const pkg = nearestPkg()
  const answer = await select({
    message: 'Replace the originals? (originals are kept in .subayai/ at the project root)',
    default: 'no',
    choices: [
      { value: 'always', name: `Always      ${c.dim(`every run from now on, change it in ${pkg ? rel(pkg) : 'package.json'}`)}` },
      { value: 'once', name: `This time   ${c.dim('replace now, ask again next time')}` },
      { value: 'no', name: `No          ${c.dim('keep the original, save the result with a suffix')}` },
    ],
  })
  if (answer === 'always') {
    if (!pkg) throw new UsageError('No package.json found. The "always" setting needs a project package.json.')
    const text = await readFile(pkg, 'utf8')
    const json = JSON.parse(text) as { subayai?: Record<string, unknown> }
    json.subayai = { ...json.subayai, replace: 'always' }
    const indent = /\n([ \t]+)"/.exec(text)?.[1] ?? 2
    await writeFile(pkg, JSON.stringify(json, null, indent) + '\n')
    log(c.yellow(`Saved "subayai.replace": "always" to ${rel(pkg)}.`))
    log(c.yellow('Originals will be replaced on every run without asking. Remove "replace" from package.json to ask again.'))
  }
  return answer !== 'no'
}

async function alwaysReplace(): Promise<boolean> {
  const pkg = nearestPkg()
  if (!pkg) return false
  try {
    return (JSON.parse(await readFile(pkg, 'utf8')) as { subayai?: { replace?: unknown } }).subayai?.replace === 'always'
  } catch {
    return false
  }
}

function validateFlags(args: string[], cmd: Command): void {
  const allowed = new Set(['all', 'dir', 'dry-run', 'json', 'help', ...(cmd.options ?? [])])
  if ('prepare' in cmd) allowed.add('yes')
  for (const arg of args) {
    if (arg === '--') break
    const flag = arg.startsWith('--') ? arg.slice(2).split('=', 1)[0] : arg === '-y' ? 'yes' : arg === '-h' ? 'help' : undefined
    if (flag && !allowed.has(flag)) throw new UsageError(`--${flag} is not supported by this command`)
  }
}

function printPlan(command: string, plan: { input: string; output: string }[], json: boolean): void {
  if (json) process.stdout.write(JSON.stringify({ command, dryRun: true, files: plan }, null, 2) + '\n')
  else for (const p of plan) log(`  ${p.input} → ${p.output}`)
}

function line(r: Result): string {
  if (r.status === 'error') return `${c.red('✖')} ${rel(r.input)}  ${c.red(r.reason ?? '')}`
  if (r.status === 'skipped') return `${c.yellow('–')} ${rel(r.input)}  ${c.dim(r.reason ?? '')}`
  if (r.after === r.before) return `${c.green('✔')} ${rel(r.input)} → ${rel(r.output ?? '')}`
  const diff = r.after !== undefined ? Math.round((1 - r.after / r.before) * 100) : 0
  const pct = diff > 0 ? c.green(`-${diff}%`) : c.dim(`+${-diff}%`)
  return `${c.green('✔')} ${rel(r.input)} → ${rel(r.output ?? '')}  ${c.dim(`${bytes(r.before)} → ${bytes(r.after ?? 0)}`)} ${pct}`
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      all: { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      dir: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      webp: { type: 'boolean', default: false },
      to: { type: 'string' },
      percent: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      px: { type: 'string' },
      radius: { type: 'string' },
      color: { type: 'string' },
      gradient: { type: 'string' },
      bg: { type: 'string' },
      out: { type: 'string' },
      brightness: { type: 'string' },
      saturation: { type: 'string' },
      watch: { type: 'boolean', default: false },
    },
  })
  if (v.json) tty.interactive = false
  if (v.help && !positionals[0]) {
    log(HELP)
    return 0
  }

  let name = positionals[0]
  let argOffset = 1
  if (!name) {
    if (!tty.interactive) {
      log(HELP)
      return 1
    }
    name = await select({
      message: 'What do you want to do?',
      pageSize: 20,
      choices: Object.entries(COMMANDS).map(([n, cmd]) => ({ name: `${n.padEnd(16)}${c.dim(cmd.summary)}`, value: n })),
    })
  } else if ((name === 'svg' || name === 'merge') && `${name} ${positionals[1]}` in COMMANDS) {
    name = `${name} ${positionals[1]}`
    argOffset = 2
  }
  const cmd: Command | undefined = COMMANDS[name]
  if (!cmd) throw new UsageError(`Unknown command "${name}". Run: npx subayai --help`)
  validateFlags(argv, cmd)
  if (v.help) {
    log(HELP)
    return 0
  }
  if (v.all && cmd.all === false) throw new UsageError(`${name} does not support --all`)
  const fileArg = positionals[argOffset]
  if (v.watch && !('mirror' in cmd)) throw new UsageError('--watch works with sync only')
  if (fileArg && ('bundle' in cmd || 'mirror' in cmd)) throw new UsageError(`${name} works on a whole folder. Run it without a file name (use --dir to pick the folder).`)
  if (fileArg && v.all) throw new UsageError('Pass either a file or --all, not both')
  const all = v.all || 'bundle' in cmd || 'mirror' in cmd

  const cfg = 'mirror' in cmd ? savedMirror() : null
  const saved = cfg?.sync
  let root = v.dir ? resolve(v.dir) : saved?.src ?? configDir()
  if (root && !existsSync(root)) throw new UsageError(`Folder not found: ${root}`)
  if (!root && tty.interactive && (nearestPkg() || localInstall() || all)) root = await askImageDir()
  const target: Target = { root, exts: cmd.inputs, video: Boolean(cmd.video), derived: DERIVED, all: cmd.all !== false, multi: Boolean(cmd.multi) }

  // sync: 이미지 폴더를 하위 폴더까지 out에 미러링. --watch는 첫 sync가 끝나 package.json에 저장된 뒤에만
  let mirror: Mirror | null = null
  if ('mirror' in cmd) {
    if (v.watch && v['dry-run']) throw new UsageError('--watch cannot be combined with --dry-run')
    if (v.watch && !saved) throw new UsageError('Run "npx subayai sync" once first. It saves the folders to package.json, then --watch can start.')
    if (!root) throw new UsageError('Missing --dir <folder> (the image folder to mirror)')
    if (v.out === undefined && !saved && !tty.interactive) throw new UsageError('Missing --out <folder> (where the optimized copies go)')
    const out = v.out !== undefined ? resolve(v.out) : saved?.out ?? (await askOut(root))
    checkMirror(root, out)
    // SVG는 React 컴포넌트로도. 폴더는 첫 셋업 때 선택 (비대화형이고 "componentOut"이 없으면 컴포넌트 생략)
    const components = cfg?.components ?? (!saved && tty.interactive ? await askComponentOut() : null)
    mirror = { src: root, out, components }
  }

  const files = mirror ? await sources(mirror.src, mirror.out, cmd.inputs) : name === 'merge video' ? await scan(root ?? process.cwd(), 0, cmd.inputs, target.derived) : all ? await pickFolder(target) : fileArg ? [await findByName(fileArg, target)] : await pickFile(target)
  const bad = files.find((f) => !cmd.inputs.includes('*') && !cmd.inputs.includes(ext(f)))
  if (bad) throw new UsageError(`${name} accepts ${cmd.inputs.join('/')} only: ${rel(bad)}`)

  const first = files[0]
  if (files.length === 1 && first) log(`${c.bold(rel(first))}  ${c.dim(await label(first, Boolean(cmd.video)))}`)
  else if (first) {
    const total = (await Promise.all(files.map((f) => stat(f)))).reduce((s, st) => s + st.size, 0)
    const dirs = new Set(files.map((f) => dirname(f)))
    const where = mirror ? rel(mirror.src) : dirs.size === 1 ? rel(dirname(first)) : `${dirs.size} folders`
    log(`${c.bold(`${files.length} files`)} in ${where}  ${c.dim(bytes(total))}`)
  }

  const flags: Flags = { webp: v.webp, to: v.to, percent: v.percent, width: v.width, height: v.height, px: v.px, radius: v.radius, color: v.color, gradient: v.gradient, bg: v.bg, out: v.out, brightness: v.brightness, saturation: v.saturation }
  const results: Result[] = []

  if ('bundle' in cmd) {
    // 이미 있는 컴포넌트는 skip만 하므로 확인 없이 진행. --dry-run이면 파일을 안 씀
    results.push(...(await cmd.bundle(files, flags, v['dry-run'])))
    if (!v.json) for (const r of results) log(line(r))
  } else if ('prepare' in cmd) {
    const job = await cmd.prepare(files, flags)
    if (!job) return 0
    // 원본 대체: -y > package.json "subayai.replace": "always" > 마지막에 질문. 비대화형은 질문 없이 대체 안 함
    let replace = v.yes || await alwaysReplace()
    const opts = (input: string) => ({ suffix: job.suffix, outExt: job.outExt(input), replace, keepSmaller: Boolean(job.keepSmaller) })

    if (v['dry-run']) {
      printPlan(name, files.map((f) => ({ input: rel(f), output: rel(outputPath(f, opts(f))) })), v.json)
      return 0
    }
    // picker에서 폴더를 고른 경우는 이미 확인함
    if (v.all && files.length > 1 && tty.interactive && !(await confirm({ message: `Process ${files.length} files?`, default: true }))) return 0
    if (!replace && tty.interactive) replace = await askReplace()

    await pool(files, cmd.serial ? 1 : 4, async (f) => {
      const r = await produce(f, opts(f), (out) => job.run(f, out))
      results.push(r)
      if (!v.json) log(line(r))
    })
  } else if (mirror) {
    const { src, out } = mirror
    // 저장된 뒤 다시 대화형 sync = 초기화: 전부 다시 만들지 확인, No면 취소. --watch / --json은 바뀐 것만
    const fresh = Boolean(saved) && tty.interactive && !v.watch && !v['dry-run']
    if (fresh && !(await confirm({ message: `Regenerate all ${files.length} files in ${rel(out)}/${mirror.components ? ' and the SVG components' : ''}?`, default: true }))) return 0
    // 결과가 최신인 파일은 결과에 안 넣음 → 전부 최신이어도 exit 0 (npm script 체인이 안 끊김)
    const todo = fresh ? files : (await Promise.all(files.map(async (f) => ((await stale(src, out, f)) ? f : null)))).filter((f) => f !== null)
    if (v['dry-run']) {
      printPlan(name, todo.map((f) => ({ input: rel(f), output: rel(mirrorPath(src, out, f)) })), v.json)
      return 0
    }
    // 첫 sync: 전부 최적화할지 확인. No면 sync 취소 + 저장 안 함 → 다음에 처음부터 다시 물음
    if (!saved) {
      if (tty.interactive && todo.length && !(await confirm({ message: `Optimize all ${todo.length} files into ${rel(out)}/?`, default: true }))) return 0
      await saveMirror(mirror)
    }
    const add = (r: Result): void => {
      results.push(r)
      if (!v.json) log(line(r))
    }
    const one = async (f: string): Promise<void> => add(await syncFile(src, out, f))
    // 영상 인코딩은 무거워서 이미지 끝난 뒤 하나씩
    await pool(todo.filter((f) => !isVideo(f)), 4, one)
    await pool(todo.filter(isVideo), 1, one)
    if (mirror.components) for (const r of await syncComponents(files.filter((f) => ext(f) === 'svg'), mirror.components, fresh)) add(r)
    if (!results.length && !v.json) log(c.dim(`${rel(out)} is up to date`))
  }

  const count = (s: Result['status']) => results.filter((r) => r.status === s).length
  const [done, skipped, failed] = [count('done'), count('skipped'), count('error')]
  if (v.json) {
    const out = results.map((r) => ({ ...r, input: rel(r.input), output: r.output && rel(r.output) }))
    process.stdout.write(JSON.stringify({ command: name, done, skipped, failed, results: out }, null, 2) + '\n')
  } else if (results.length > 1) {
    const ok = results.filter((r) => r.status === 'done')
    const before = ok.reduce((s, r) => s + r.before, 0)
    const after = ok.reduce((s, r) => s + (r.after ?? 0), 0)
    log(`\nDone ${done}, skipped ${skipped}, failed ${failed}${ok.length && before !== after ? `  ${c.dim(`${bytes(before)} → ${bytes(after)}`)}` : ''}`)
  }
  if (mirror && v.watch) {
    log(c.dim(`Watching ${rel(mirror.src)} → ${rel(mirror.out)}  (Ctrl+C to stop)`))
    return watchMirror(mirror, cmd.inputs, (r) => {
      if (v.json) process.stdout.write(JSON.stringify({ ...r, input: rel(r.input), output: r.output && rel(r.output) }) + '\n')
      else log(line(r))
    })
  }
  // exit code: 0 성공, 1 에러, 2 전부 skip
  return failed ? 1 : done === 0 && skipped ? 2 : 0
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof Error && e.name === 'ExitPromptError') process.exit(130) // Ctrl+C
    const msg = e instanceof Error ? e.message : String(e)
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ error: msg }) + '\n')
    log(c.red(msg))
    process.exit(1)
  },
)
