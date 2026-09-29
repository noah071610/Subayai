import sharp, { type Sharp } from 'sharp'
import { isGradient, sampler, type Fill } from './gradient.js'

type Rgb = [number, number, number]

export const DEFAULT_TOLERANCE = 48 // RGB 유클리드 거리 (0~441)
const OPAQUE = 250 // 이 이상이면 불투명으로 봄
const MONO = 0.95

export class MultiColorError extends Error {}

export interface Analysis {
  data: Buffer // RGBA raw, EXIF 회전 반영
  width: number
  height: number
  hasAlpha: boolean // 원본에 알파 채널이 있었는지 (출력 채널 유지용)
  transparent: boolean // 투명 픽셀이 있으면 알파 기준, 없으면 모서리 배경 기준
  bgs: Rgb[] // 모서리 배경색 (transparent면 비어 있음)
  color: Rgb // 지배색
  tolerance: number
}

const dist = (d: Buffer, i: number, c: Rgb): number => Math.hypot(d[i]! - c[0], d[i + 1]! - c[1], d[i + 2]! - c[2])

// 픽셀이 선분 a→b 위 어디쯤인지(t: 0=a, 1=b)와 선분까지의 거리. 안티앨리어싱 = 두 색의 혼합
function segment(d: Buffer, i: number, a: Rgb, b: Rgb): { t: number; dist: number } {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
  const ap = [d[i]! - a[0], d[i + 1]! - a[1], d[i + 2]! - a[2]] as const
  const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const t = len2 ? Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / len2)) : 0
  return { t, dist: Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]) }
}

// 가장 가까운 배경↔지배색 혼합선
function nearestMix(d: Buffer, i: number, bgs: Rgb[], color: Rgb): { t: number; dist: number; bg: Rgb } | null {
  let best: { t: number; dist: number; bg: Rgb } | null = null
  for (const bg of bgs) {
    const s = segment(d, i, bg, color)
    if (!best || s.dist < best.dist) best = { ...s, bg }
  }
  return best
}

// 단색이 아니면 MultiColorError
export async function analyze(file: string, tolerance = DEFAULT_TOLERANCE): Promise<Analysis> {
  const img = sharp(file).rotate()
  const { hasAlpha } = await img.metadata()
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = info

  // ponytail: 알파 채널이 있어도 전부 불투명이면(흰 배경 PNG 등) 모서리 방식으로 판정
  let transparent = false
  for (let i = 3; i < data.length; i += 4) if (data[i]! < OPAQUE) { transparent = true; break }
  const bgs: Rgb[] = []
  if (!transparent) {
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]] as const) {
      const i = (y * width + x) * 4
      if (!bgs.some((b) => dist(data, i, b) <= tolerance)) bgs.push([data[i]!, data[i + 1]!, data[i + 2]!])
    }
  }
  const isFg = (i: number): boolean => (transparent ? data[i + 3]! >= OPAQUE : bgs.every((b) => dist(data, i, b) > tolerance))

  // 클러스터링: 4bit 양자화 히스토그램의 최빈 칸 → 그 칸 픽셀 평균 = 지배색
  // ponytail: 최빈 칸 1개 기준. 그라데이션 로고처럼 한 색이 여러 칸에 걸치면 k-means로 교체
  const bucket = (i: number): number => ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4)
  const hist = new Uint32Array(4096)
  for (let i = 0; i < data.length; i += 4) if (isFg(i)) hist[bucket(i)]!++
  let best = 0
  for (let k = 1; k < hist.length; k++) if (hist[k]! > hist[best]!) best = k
  if (!hist[best]) throw new MultiColorError('No logo or icon found: the image has no foreground pixels.')
  const sum = [0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    if (isFg(i) && bucket(i) === best) for (let k = 0; k < 3; k++) sum[k]! += data[i + k]!
  }
  const color = sum.map((s) => Math.round(s / hist[best]!)) as Rgb

  // 판정: 지배색 근처 / 그 외. 배경↔지배색 혼합(안티앨리어싱)은 제외
  // ponytail: 배경과 지배색 사이 색(흰 배경 + 검정 로고의 회색 글자 등)도 혼합으로 보고 무시됨
  let dominant = 0
  let other = 0
  for (let i = 0; i < data.length; i += 4) {
    if (!isFg(i)) continue
    if (dist(data, i, color) <= tolerance) dominant++
    else if (transparent || (nearestMix(data, i, bgs, color)?.dist ?? Infinity) > tolerance) other++
  }
  const ratio = dominant / (dominant + other)
  if (ratio < MONO) {
    throw new MultiColorError(`2 or more colors detected in the image (the main color covers ${Math.round(ratio * 100)}% of the logo). recolor only works on single-color logos and icons.`)
  }
  return { data, width, height, hasAlpha: Boolean(hasAlpha), transparent, bgs, color, tolerance }
}

// 칠할 픽셀이면 투명 방식은 true, 모서리 방식은 배경↔지배색 혼합 정보. 아니면 null
function target(a: Analysis, i: number): true | { t: number; bg: Rgb } | null {
  if (a.transparent) return a.data[i + 3] === 0 || dist(a.data, i, a.color) > a.tolerance ? null : true
  const mix = nearestMix(a.data, i, a.bgs, a.color)
  return !mix || mix.dist > a.tolerance || mix.t === 0 ? null : mix
}

// 칠할 픽셀의 bbox. 그라디언트가 이미지 전체가 아니라 로고에 맞게 걸리도록
function bounds(a: Analysis): { x: number; y: number; w: number; h: number } {
  let x0 = a.width
  let y0 = a.height
  let x1 = 0
  let y1 = 0
  for (let p = 0; p < a.width * a.height; p++) {
    if (!target(a, p * 4)) continue
    const x = p % a.width
    const y = Math.floor(p / a.width)
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
}

// 지배색 계열 픽셀만 새 색(또는 그라디언트)으로. 알파값과 배경과의 혼합 비율은 유지 → 경계가 거칠어지지 않음
export function paint(a: Analysis, fill: Fill): Sharp {
  const data = Buffer.from(a.data)
  const box = isGradient(fill) ? bounds(a) : { x: 0, y: 0, w: 1, h: 1 }
  const colorAt = sampler(fill)
  for (let i = 0; i < data.length; i += 4) {
    const hit = target(a, i)
    if (!hit) continue
    const p = i / 4
    const color = colorAt((p % a.width - box.x) / box.w, (Math.floor(p / a.width) - box.y) / box.h)
    const next: Rgb = [color.r, color.g, color.b]
    if (hit === true) {
      for (let k = 0; k < 3; k++) data[i + k] = next[k]!
      data[i + 3] = Math.round(data[i + 3]! * color.alpha)
      continue
    }
    // 새 색이 반투명이면 배경 위에 합성한 색을 목표로
    for (let k = 0; k < 3; k++) {
      const goal = hit.bg[k]! + (next[k]! - hit.bg[k]!) * color.alpha
      data[i + k] = Math.round(hit.bg[k]! + hit.t * (goal - hit.bg[k]!))
    }
  }
  const out = sharp(data, { raw: { width: a.width, height: a.height, channels: 4 } })
  return a.hasAlpha ? out : out.removeAlpha()
}
