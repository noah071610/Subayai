import sharp, { type Sharp } from 'sharp'
import { parseColor, toHex, UsageError, type Rgba } from './ui.js'

// 시작점은 왼쪽 위(0,0), 끝점은 to 방향
export interface Gradient { to: 'right' | 'bottom' | 'bottom right'; stops: string[] }
export type Fill = Rgba | Gradient
export const isGradient = (f: Fill): f is Gradient => 'stops' in f

export function gradientOf(value: string): Gradient {
  const colors = value.split(',').map((color) => color.trim())
  if (colors.length !== 2 || colors.some((color) => !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) || !parseColor(color))) {
    throw new UsageError('--gradient must be two hex colors separated by a comma, e.g. "#ff0000,#0000ff"')
  }
  return { to: 'right', stops: colors.map((color) => toHex(parseColor(color)!)) }
}

const end = (g: Gradient) => ({ x: g.to.includes('right') ? 1 : 0, y: g.to.includes('bottom') ? 1 : 0 })

export function gradientDef(g: Gradient, id: string): string {
  const { x, y } = end(g)
  const stops = g.stops.map((c, k) => `<stop offset="${k / (g.stops.length - 1)}" stop-color="${c}"/>`).join('')
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${x}" y2="${y}">${stops}</linearGradient>`
}

// 박스 안 0~1 좌표(u, v) → 색. SVG objectBoundingBox 선형 그라디언트와 같은 계산 (범위 밖은 끝 색)
export function sampler(fill: Fill): (u: number, v: number) => Rgba {
  if (!isGradient(fill)) return () => fill
  const stops = fill.stops.map((c) => parseColor(c) ?? { r: 0, g: 0, b: 0, alpha: 1 })
  const { x, y } = end(fill)
  const len2 = x * x + y * y
  return (u, v) => {
    const t = Math.min(1, Math.max(0, (u * x + v * y) / len2)) * (stops.length - 1)
    const k = Math.min(Math.floor(t), stops.length - 2)
    const a = stops[k]!
    const b = stops[k + 1]!
    const f = t - k
    const mix = (p: number, q: number): number => p + (q - p) * f
    return { r: Math.round(mix(a.r, b.r)), g: Math.round(mix(a.g, b.g)), b: Math.round(mix(a.b, b.b)), alpha: mix(a.alpha, b.alpha) }
  }
}

// 단색이 필요한 곳(JPG flatten 등)은 첫 stop
export const solid = (fill: Fill): Rgba => sampler(fill)(0, 0)

// fill로 칠한 width×height 캔버스
export function canvas(fill: Fill, width: number, height: number): Sharp {
  if (!isGradient(fill)) return sharp({ create: { width, height, channels: 4, background: fill } })
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${gradientDef(fill, 'g')}<rect width="100%" height="100%" fill="url(#g)"/></svg>`))
}
