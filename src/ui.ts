import { styleText } from 'node:util'
import { createPrompt, isDownKey, isEnterKey, isSpaceKey, isUpKey, makeTheme, useEffect, useKeypress, usePagination, usePrefix, useState } from '@inquirer/core'
import { input, select } from '@inquirer/prompts'

// TTY + --json 아님일 때만 prompt. AI/CI 환경에선 flag 누락 시 즉시 에러
export const tty = { interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) }

export class UsageError extends Error {}
export class SkipError extends Error {}
export class LimitError extends Error {}

function need(flag: string, hint: string): never {
  throw new UsageError(`Missing --${flag} (${hint}). Pass it as a flag in non-interactive mode.`)
}

export async function choose<T extends string>(
  flag: string,
  value: string | undefined,
  message: string,
  choices: readonly { value: T; name: string }[],
): Promise<T> {
  const values = choices.map((c) => c.value)
  if (value !== undefined) {
    const hit = values.find((v) => v === value)
    if (!hit) throw new UsageError(`Invalid --${flag} "${value}". Use one of: ${values.join(', ')}`)
    return hit
  }
  if (!tty.interactive) need(flag, values.join('|'))
  return select({ message, choices: [...choices] })
}

export async function askInt(flag: string, value: string | undefined, message: string, min = 1): Promise<number> {
  const parse = (s: string): number | null => {
    const n = Number(s.trim())
    return Number.isInteger(n) && n >= min ? n : null
  }
  if (value !== undefined) {
    const n = parse(value)
    if (n === null) throw new UsageError(`--${flag} must be an integer >= ${min}`)
    return n
  }
  if (!tty.interactive) need(flag, `integer >= ${min}`)
  const s = await input({ message, validate: (v) => parse(v) !== null || `Enter an integer >= ${min}` })
  return parse(s) ?? min
}

export interface Rgba { r: number; g: number; b: number; alpha: number }

// CSS 색 이름 148개 (transparent, currentColor는 색으로 취급 안 함)
const NAMES = new Map(
  ('aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
    'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
    'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
    'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b ' +
    'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
    'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 ' +
    'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 ' +
    'fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f ' +
    'grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
    'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
    'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
    'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de ' +
    'lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa ' +
    'mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee ' +
    'mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa ' +
    'mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 ' +
    'orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee ' +
    'palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 ' +
    'purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 ' +
    'sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd ' +
    'slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 ' +
    'tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32')
    .split(' ')
    .map((s) => s.split(':') as [string, string]),
)

// ponytail: rgb(0 0 0 / 50%) 같은 공백 문법, hsl()은 미지원. 필요해지면 여기만 확장
export function parseColor(s: string): Rgba | null {
  const t = s.trim()
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(NAMES.get(t.toLowerCase()) ?? t)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), alpha: full.length === 8 ? n(6) / 255 : 1 }
  }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)(%?)\s*)?\)$/i.exec(t)
  if (!m) return null
  const [r, g, b] = [m[1], m[2], m[3]].map(Number)
  let alpha = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1)
  if (r === undefined || g === undefined || b === undefined || [r, g, b].some((v) => v > 255) || !(alpha >= 0 && alpha <= 1)) return null
  alpha = Math.round(alpha * 100) / 100
  return { r, g, b, alpha }
}

// ponytail: truecolor ANSI 직접 출력. 24bit 미지원 터미널은 근사색으로 보임
export function swatch(c: Rgba): string {
  return `\x1b[48;2;${c.r};${c.g};${c.b}m      \x1b[0m`
}

// #rrggbb, 투명도가 있으면 #rrggbbaa
export function toHex(c: Rgba): string {
  const channels = c.alpha < 1 ? [c.r, c.g, c.b, Math.round(c.alpha * 255)] : [c.r, c.g, c.b]
  return '#' + channels.map((v) => v.toString(16).padStart(2, '0')).join('')
}

export function colorLabel(c: Rgba): string {
  return `${swatch(c)} ${toHex(c).slice(0, 7)}${c.alpha < 1 ? `  alpha ${c.alpha}` : ''}`
}

export async function askColor(flag: string, value: string | undefined, message: string): Promise<Rgba> {
  if (value !== undefined) {
    const c = parseColor(value)
    if (!c) throw new UsageError(`Invalid --${flag} "${value}". Use hex (#fff, #ffffff, #ffffff80), rgba(255,255,255,0.5) or a color name (red)`)
    log(`Color: ${colorLabel(c)}`)
    return c
  }
  if (!tty.interactive) need(flag, 'hex, rgba() or color name')
  const s = await input({
    message,
    // 타이핑 중에 색 미리보기
    transformer: (v) => {
      const c = parseColor(v)
      return c ? `${v}  ${swatch(c)}` : v
    },
    validate: (v) => parseColor(v) !== null || 'Use hex (#fff, #ffffff), rgba(255,255,255,0.5) or a color name (red)',
  })
  const c = parseColor(s)
  if (!c) throw new UsageError('Invalid color')
  log(`Color: ${colorLabel(c)}`)
  return c
}

export function bytes(n: number): string {
  if (n < 1024) return `${n}B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 ? 1 : 0)}${units[i]}`
}

// --json 모드에선 stdout을 JSON 전용으로 비워두기 위해 사람용 로그는 stderr
export function log(msg: string): void {
  process.stderr.write(msg + '\n')
}

export const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

export interface Row { key: string; name: string; value: string[] }

// search + checkbox. space = 체크 토글, enter = 체크한 것 전부 (없으면 커서 위치 하나). 그래서 검색어에 공백은 못 씀
export const searchMany = createPrompt<string[], { message: string; pageSize: number; source: (term: string) => Promise<Row[]> }>((config, done) => {
  const theme = makeTheme()
  const [status, setStatus] = useState<'idle' | 'done'>('idle')
  const [term, setTerm] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [active, setActive] = useState(0)
  const [checked, setChecked] = useState<ReadonlyMap<string, string[]>>(new Map())
  const prefix = usePrefix({ status, theme })
  const picked = (): string[] | undefined => (checked.size ? [...new Set([...checked.values()].flat())] : rows[active]?.value)

  useEffect(() => {
    let stale = false
    void config.source(term).then((r) => {
      if (stale) return
      setRows(r)
      setActive(0)
    })
    return () => {
      stale = true
    }
  }, [term])

  useKeypress((key, rl) => {
    const row = rows[active]
    if (isEnterKey(key)) {
      const value = picked()
      if (!value) {
        rl.write(term) // enter가 입력줄을 비움 → 복구
        return
      }
      setStatus('done')
      done(value)
    } else if (isSpaceKey(key) || isUpKey(key) || isDownKey(key)) {
      // 공백/히스토리가 입력줄에 들어가지 않게 검색어로 되돌림
      rl.clearLine(0)
      rl.write(term)
      if (isSpaceKey(key)) {
        if (!row) return
        const next = new Map(checked)
        if (!next.delete(row.key)) next.set(row.key, row.value)
        setChecked(next)
      } else setActive(Math.max(0, Math.min(rows.length - 1, active + (isUpKey(key) ? -1 : 1))))
    } else setTerm(rl.line)
  })

  const page = usePagination({
    items: rows,
    active,
    pageSize: config.pageSize,
    loop: false,
    renderItem: ({ item, isActive }) => {
      const line = `${checked.has(item.key) ? c.green('◉') : '◯'} ${item.name}`
      return isActive ? theme.style.highlight(`❯ ${line}`) : `  ${line}`
    },
  })
  const message = theme.style.message(config.message, status)
  if (status === 'done') return `${prefix} ${message} ${theme.style.answer(`${picked()?.length ?? 0} files`)}`
  const count = checked.size ? c.bold(`${checked.size} selected  `) : ''
  return [
    `${prefix} ${message} ${styleText('cyan', term)}`.trimEnd(),
    `${rows.length ? page : c.red('No results found')}\n${count}${c.dim('space select • ⏎ confirm • ↑↓ navigate')}`,
  ]
})
