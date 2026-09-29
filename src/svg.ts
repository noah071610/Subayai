import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { search } from '@inquirer/prompts'
import { optimize, type CustomPlugin, type XastElement } from 'svgo'
import type { Flags } from './commands.js'
import { folders, nearestPkg, rel, type Result } from './files.js'
import { gradientDef, isGradient, type Fill } from './gradient.js'
import { SkipError, UsageError, c, log, parseColor, toHex, tty } from './ui.js'

// preset-default: 주석, 메타데이터, 에디터 흔적 제거 + 경로/숫자 압축. svgo v4는 viewBox를 지우지 않음
export const optimizeSvg = (svg: string): string => optimize(svg, { multipass: true }).data

// width/height 제거, viewBox만 남김. viewBox가 없으면 width/height로 만들어줌
export function responsiveSvg(svg: string): string {
  const sized = (s: string): boolean => /<svg\b[^>]*\s(?:width|height)=/.test(s)
  if (!sized(svg)) throw new SkipError('already responsive (no width/height)')
  const out = optimize(svg, { plugins: ['removeDimensions'] }).data
  if (sized(out)) throw new SkipError('no viewBox, and width/height are not plain numbers')
  return out
}

export async function transformSvg(input: string, output: string, fn: (svg: string) => string): Promise<void> {
  await writeFile(output, fn(await readFile(input, 'utf8')))
}

const COLOR_PROPS = ['fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'color']
// CSS 선언 속 색. lookbehind로 경계 체크 (stop-color 안의 color 오탐 방지)
const DECL = /(?<=^|[{;\s])(fill|stroke|stop-color|flood-color|lighting-color|color)(\s*:\s*)([^;}!]+)/gi
// fill을 안 주면 기본값 검정으로 칠해지는 요소
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text'])
// 마스크는 흑백 자체가 의미, clipPath는 색이 안 보임 → 건드리지 않음
const SKIP = new Set(['mask', 'clipPath'])

// 색이 들어가는 모든 곳(속성, style 속성, <style>)에서 색을 #rrggbb[aa]로 정규화해 fn 결과로 교체
// none, currentColor, url(#grad) 등 색이 아닌 값은 그대로
// ponytail: <style>의 class 규칙으로만 칠해진 도형은 기본 검정으로 오인함. svgo inlineStyles 이후엔 드묾
function colorPlugin(fn: (hex: string) => string): CustomPlugin {
  const swap = (v: string): string => {
    const color = parseColor(v)
    return color ? fn(toHex(color)) : v
  }
  const css = (s: string): string =>
    s.replace(DECL, (_: string, prop: string, colon: string, value: string) => {
      const v = value.trimEnd()
      return `${prop}${colon}${swap(v)}${value.slice(v.length)}`
    })
  return {
    name: 'colors',
    fn: () => {
      const filled: boolean[] = [] // 조상에 fill이 지정됐는지
      let skip = 0
      let root: XastElement | null = null
      let implicit = false
      return {
        element: {
          enter: (node) => {
            root ??= node
            if (skip || SKIP.has(node.name)) {
              skip++
              return
            }
            const a = node.attributes
            const hasFill = (filled.at(-1) ?? false) || a.fill !== undefined || /(?:^|;)\s*fill\s*:/.test(a.style ?? '')
            filled.push(hasFill)
            if (SHAPES.has(node.name) && !hasFill) implicit = true
            for (const p of COLOR_PROPS) {
              const v = a[p]
              if (v !== undefined) a[p] = swap(v)
            }
            if (a.style !== undefined) a.style = css(a.style)
            if (node.name === 'style') for (const ch of node.children) if (ch.type === 'text' || ch.type === 'cdata') ch.value = css(ch.value)
          },
          exit: (node) => {
            if (skip) {
              skip--
              return
            }
            filled.pop()
            if (node === root && implicit) node.attributes.fill = fn('#000000')
          },
        },
      }
    },
  }
}

export function colorsOf(svg: string): Set<string> {
  const seen = new Set<string>()
  optimize(svg, {
    plugins: [
      colorPlugin((hex) => {
        seen.add(hex)
        return hex
      }),
    ],
  })
  return seen
}

export function recolorSvg(svg: string, color: string): string {
  const out = optimize(svg, { plugins: [colorPlugin(() => color)] }).data
  const c = parseColor(color)
  if (!c || !/<image\b/i.test(out)) return out
  const id = 'subayai-recolor-raster'
  const values = `0 0 0 0 ${c.r / 255} 0 0 0 0 ${c.g / 255} 0 0 0 0 ${c.b / 255} 0 0 0 ${c.alpha} 0`
  const filter = `<defs><filter id="${id}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter></defs>`
  return out
    .replace(/<svg\b[^>]*>/i, (root) => root + filter)
    .replace(/<image\b(?![^>]*\bfilter\s*=)/gi, `<image filter="url(#${id})"`)
}

// 단색은 recolorSvg. 그라디언트: 전부 흰색으로 칠한 원본을 마스크로 쓰고 그라디언트 사각형을 덮음
// fill="url(#g)" 치환은 path마다 그라디언트가 따로 걸리고(objectBoundingBox) transform에 좌표가 틀어져서 안 씀
// id는 원본 해시 → 한 페이지에 여러 SVG를 인라인해도 충돌 없음
// ponytail: 그라디언트 범위는 viewBox 전체. 로고 주변 여백이 크면 끝 색이 덜 보임 → 필요하면 래스터로 bbox 계산
export function paintSvg(svg: string, fill: Fill): string {
  if (!isGradient(fill)) return recolorSvg(svg, toHex(fill))
  const white = recolorSvg(svg, '#ffffff')
  const m = /^([\s\S]*?<svg\b[^>]*[^/]>)([\s\S]*)(<\/svg>\s*)$/i.exec(white)
  if (!m) throw new UsageError('Could not read the SVG root element')
  const [, open = '', body = '', close = ''] = m
  const id = `subayai-${createHash('sha1').update(svg).digest('hex').slice(0, 8)}`
  // viewBox 시작점이 0이 아닐 수 있음. 크기는 100% = viewBox(없으면 width/height) 크기
  const vb = /\bviewBox\s*=\s*["']\s*([-+\d.e]+)[\s,]+([-+\d.e]+)/i.exec(open)
  return `${open}<defs>${gradientDef(fill, `${id}-g`)}<mask id="${id}-m">${body}</mask></defs><rect x="${vb?.[1] ?? 0}" y="${vb?.[2] ?? 0}" width="100%" height="100%" fill="url(#${id}-g)" mask="url(#${id}-m)"/>${close}`
}

// ---------- component ----------

const jsxName = (k: string): string =>
  k === 'class' ? 'className' : /^(data|aria)-/.test(k) ? k : k.replace(/[-:]([a-z])/g, (_: string, ch: string) => ch.toUpperCase())

// "mix-blend-mode:multiply;opacity:.5" → {"mixBlendMode": "multiply", "opacity": ".5"}
function styleObject(style: string): string {
  const entries = style
    .split(';')
    .map((d) => d.split(/:(.*)/s).map((s) => s.trim()))
    .filter((kv): kv is [string, string] => Boolean(kv[0] && kv[1]))
    .map(([k, v]) => `${JSON.stringify(k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_: string, ch: string) => ch.toUpperCase()))}: ${JSON.stringify(v)}`)
  return `{${entries.join(', ')}}`
}

// svgo AST에서 JSX 규칙으로 바꾼 뒤 문자열화. JSX 식이 필요한 곳은 placeholder로 두고 나중에 치환
function toJsx(svg: string): string {
  const exprs: string[] = []
  const hold = (e: string): string => `__subayai${exprs.push(e) - 1}__`
  const out = optimize(svg, {
    js2svg: { pretty: true, indent: 2 },
    plugins: [
      {
        name: 'jsx',
        fn: () => ({
          element: {
            enter: (node, parent) => {
              const attrs: Record<string, string> = {}
              for (const [k, v] of Object.entries(node.attributes)) {
                if (k === 'style') attrs.style = hold(styleObject(v))
                else attrs[jsxName(k)] = v
              }
              if (parent.type === 'root') attrs['data-subayai-props'] = ''
              node.attributes = attrs
              if (node.name === 'style') {
                const css = node.children.map((ch) => (ch.type === 'text' || ch.type === 'cdata' ? ch.value : '')).join('')
                node.children = [{ type: 'text', value: hold(JSON.stringify(css)) }]
              }
            },
          },
          // JSX 텍스트에서 { } 는 식으로 해석됨
          text: {
            enter: (node) => {
              if (/[{}]/.test(node.value)) node.value = hold(JSON.stringify(node.value))
            },
          },
        }),
      },
    ],
  }).data
  const expr = (i: string): string => exprs[Number(i)] ?? ''
  return out
    .replace(/="__subayai(\d+)__"/g, (_: string, i: string) => `={${expr(i)}}`)
    .replace(/__subayai(\d+)__/g, (_: string, i: string) => `{${expr(i)}}`)
    .replace(' data-subayai-props=""', ' {...props}')
}

// arrow-left.svg → ArrowLeft, 24-home.svg → Svg24Home. 영숫자가 없으면 ''
function componentName(file: string): string {
  const name = basename(file, extname(file))
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
  return /^\d/.test(name) ? `Svg${name}` : name
}

// optimize → responsive → 한 가지 색이면 currentColor, 여러 색이면 color1, color2… props(기본값 = 원래 색) → JSX
function toComponent(svg: string, name: string, tsx: boolean): string {
  // 여러 아이콘이 한 페이지에 있어도 gradient/clipPath id가 겹치지 않게
  const prefix = name.replace(/(?<=[a-z0-9])(?=[A-Z])/g, '-').toLowerCase()
  let s = optimize(svg, {
    multipass: true,
    plugins: ['preset-default', 'removeDimensions', 'convertStyleToAttrs', { name: 'prefixIds', params: { prefix } }],
  }).data
  const colors = [...colorsOf(s)] // 처음 등장한 순서
  if (colors.length <= 1) s = recolorSvg(s, 'currentColor')
  else s = optimize(s, { plugins: [colorPlugin((hex) => `__subayaic${colors.indexOf(hex)}__`)] }).data
  const prop = (i: string): string => `color${Number(i) + 1}`
  const body = toJsx(s)
    .replace(/="__subayaic(\d+)__"/g, (_: string, i: string) => `={${prop(i)}}`) // 속성
    .replace(/"__subayaic(\d+)__"/g, (_: string, i: string) => prop(i)) // style 객체 값
    // ponytail: <style> 안 색은 props로 못 바꿈, 원래 색 유지
    .replace(/__subayaic(\d+)__/g, (_: string, i: string) => colors[Number(i)] ?? '')
    .trim()
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
  if (colors.length <= 1) return `export const ${name} = (props${tsx ? ': SVGProps<SVGSVGElement>' : ''}) => (\n${body}\n)\n`
  const defaults = colors.map((hex, i) => `color${i + 1} = '${hex}'`).join(', ')
  const types = tsx ? `: SVGProps<SVGSVGElement> & { ${colors.map((_, i) => `color${i + 1}?: string`).join('; ')} }` : ''
  return `export const ${name} = ({ ${defaults}, ...props }${types}) => (\n${body}\n)\n`
}

type Json = Record<string, unknown>
const readPkg = (pkg: string): Json => JSON.parse(readFileSync(pkg, 'utf8')) as Json
const settings = (json: Json): Json => (typeof json.subayai === 'object' && json.subayai !== null ? (json.subayai as Json) : {})
const posix = (p: string): string => p.split(sep).join('/')

// --out > package.json "subayai.componentOut" > 입력(기존 폴더 자동완성, 없는 경로면 새로 만듦)
async function outputDir(base: string, pkg: string | null, flag: string | undefined, dryRun: boolean): Promise<string> {
  if (flag) return resolve(flag)
  const saved = pkg ? settings(readPkg(pkg)).componentOut : undefined
  if (typeof saved === 'string') return resolve(base, saved)
  if (!tty.interactive) throw new UsageError('Missing --out <folder> (where the component file goes). Pass it as a flag in non-interactive mode.')
  // 프로젝트 안 모든 폴더 (depth 제한 없음)
  const dirs = (await folders(base)).filter((d) => d !== base).map((d) => posix(relative(base, d)))
  const picked = await search({
    message: 'Where should the components go? (type a path)',
    pageSize: 12,
    source: async (term) => {
      const t = (term ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '')
      const rows = dirs
        .filter((d) => d.toLowerCase().includes(t.toLowerCase()))
        .slice(0, 50)
        .map((d) => ({ name: d, value: d }))
      return t && !dirs.includes(t) ? [{ name: `${t}  ${c.dim('(new folder)')}`, value: t }, ...rows] : rows
    },
  })
  const out = resolve(base, picked)
  if (pkg && !dryRun) {
    const json = readPkg(pkg)
    const value = posix(relative(dirname(pkg), out)) || '.'
    json.subayai = { ...settings(json), componentOut: value }
    // ponytail: 들여쓰기 2칸 고정. 탭/4칸 package.json이면 포맷이 바뀜
    writeFileSync(pkg, JSON.stringify(json, null, 2) + '\n')
    log(c.dim(`Saved "componentOut": "${value}" to ${rel(pkg)}`))
  }
  return out
}

// 폴더 안 SVG 전부 → <out>/<folder>-graphics.tsx 한 파일에 named export
// 같은 이름의 컴포넌트가 이미 있으면 skip (기존 코드는 안 건드림). fresh = 기존 파일 무시하고 새로 씀
export async function component(files: string[], f: Flags, dryRun: boolean, fresh = false): Promise<Result[]> {
  const pkg = nearestPkg()
  const base = pkg ? dirname(pkg) : process.cwd()
  const tsx = existsSync(join(base, 'tsconfig.json'))
  const outDir = await outputDir(base, pkg, f.out, dryRun)
  const file = join(outDir, `${basename(dirname(files[0] ?? ''))}-graphics.${tsx ? 'tsx' : 'jsx'}`)
  const existing = !fresh && existsSync(file) ? readFileSync(file, 'utf8') : ''
  const taken = new Set([...existing.matchAll(/export const (\w+)/g)].map((m) => m[1] ?? ''))
  const chunks: string[] = []
  const results: Result[] = []
  for (const input of files) {
    const before = (await stat(input)).size
    const name = componentName(input)
    if (!name) {
      results.push({ input, before, status: 'skipped', reason: 'file name has no letters or digits' })
      continue
    }
    if (taken.has(name)) {
      results.push({ input, before, status: 'skipped', reason: `${name} already exists in ${rel(file)}` })
      continue
    }
    try {
      const chunk = toComponent(await readFile(input, 'utf8'), name, tsx)
      taken.add(name)
      chunks.push(chunk)
      results.push({ input, output: file, before, after: Buffer.byteLength(chunk), status: 'done' })
    } catch (e) {
      results.push({ input, before, status: 'error', reason: e instanceof Error ? e.message : String(e) })
    }
  }
  if (chunks.length && !dryRun) {
    await mkdir(outDir, { recursive: true })
    if (existing) await appendFile(file, `\n${chunks.join('\n')}`)
    else await writeFile(file, `${tsx ? "import type { SVGProps } from 'react'\n\n" : ''}${chunks.join('\n')}`)
  }
  return results
}
