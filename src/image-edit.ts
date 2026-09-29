import { randomBytes } from 'node:crypto'
import sharp, { type Sharp } from 'sharp'
import { dims } from './files.js'

export interface ImageEdits {
  brightness: number
  saturation: number
  hue: number
  pixelate: number
  blur: number
  noise: number
  sharpen: number
  grayscale: boolean
  radius: number // 모서리 둥글기 px (원본 기준)
  px: number // 투명 여백 px
  shadow: ShadowSize
  inset: boolean
  background: string | null
  rotate: number // 시계방향 각도 0-359
}

export type ShadowSize = 'none' | 'small' | 'medium' | 'large'

export function shadowMetrics(shortSide: number, size: ShadowSize): { blur: number; offset: number; padding: number } {
  const factors: Record<ShadowSize, readonly [number, number]> = { none: [0, 0], small: [0.008, 0.004], medium: [0.016, 0.008], large: [0.03, 0.015] }
  const factor = factors[size]
  const blur = size === 'none' ? 0 : Math.min(100, Math.max(1, shortSide * factor[0]))
  const offset = size === 'none' ? 0 : Math.max(1, Math.round(shortSide * factor[1]))
  return { blur, offset, padding: blur ? Math.ceil(blur * 3 + offset) : 0 }
}

export const DEFAULT_EDITS: ImageEdits = {
  brightness: 1,
  saturation: 1,
  hue: 0,
  pixelate: 1,
  blur: 0,
  noise: 0,
  sharpen: 0,
  grayscale: false,
  radius: 0,
  px: 0,
  shadow: 'none',
  inset: false,
  background: null,
  rotate: 0,
}

export function parseEditSettings(value: unknown): ImageEdits | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const numbers = ['brightness', 'saturation', 'hue', 'pixelate', 'blur', 'noise', 'sharpen'] as const
  if (numbers.some((key) => typeof v[key] !== 'number' || !Number.isFinite(v[key]))) return null
  const brightness = v.brightness as number
  const saturation = v.saturation as number
  const hue = v.hue as number
  const pixelate = v.pixelate as number
  const blur = v.blur as number
  const noise = v.noise as number
  const sharpen = v.sharpen as number
  if (brightness < 0 || brightness > 2 || saturation < 0 || saturation > 3 || hue < -180 || hue > 180 || pixelate < 1 || pixelate > 40 || blur < 0 || blur > 30 || noise < 0 || noise > 0.5 || sharpen < 0 || sharpen > 5 || typeof v.grayscale !== 'boolean') return null
  const int = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100_000
  if (!int(v.radius) || !int(v.px) || !['none', 'small', 'medium', 'large'].includes(String(v.shadow)) || typeof v.inset !== 'boolean') return null
  if (v.background !== null && (typeof v.background !== 'string' || !/^#[\da-f]{6}$/i.test(v.background))) return null
  if (!Number.isInteger(v.rotate) || (v.rotate as number) < 0 || (v.rotate as number) >= 360) return null
  return { brightness, saturation, hue, pixelate, blur, noise, sharpen, grayscale: v.grayscale, radius: v.radius, px: v.px, shadow: v.shadow as ShadowSize, inset: v.inset, background: v.background, rotate: v.rotate as number }
}

async function noiseLayer(width: number, height: number, amount: number, seed: number): Promise<Buffer> {
  // ponytail: 노이즈 타일이 256px마다 반복됨. 반복 무늬가 보이면 비반복 스트리밍 노이즈로 교체
  const size = 256
  const pixels = Buffer.alloc(size * size)
  let state = seed || 1
  for (let i = 0; i < pixels.length; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    pixels[i] = state & 255
  }
  const tile = await sharp(pixels, { raw: { width: size, height: size, channels: 1 } }).png().toBuffer()
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="n" width="${size}" height="${size}" patternUnits="userSpaceOnUse"><image width="${size}" height="${size}" href="data:image/png;base64,${tile.toString('base64')}"/></pattern></defs><rect width="100%" height="100%" fill="url(#n)" opacity="${amount}"/></svg>`)
}

async function addShadow(buffer: Buffer, shortSide: number, size: ShadowSize): Promise<Buffer> {
  const { blur, offset, padding } = shadowMetrics(shortSide, size)
  if (!blur) return buffer
  const source = await sharp(buffer).ensureAlpha().png().toBuffer()
  const { width = 0, height = 0 } = await sharp(source).metadata()
  const mask = await sharp(source).extractChannel('alpha')
    .extend({ top: padding + offset, bottom: padding - offset, left: padding + offset, right: padding - offset, background: '#000' })
    .blur(blur).png().toBuffer()
  const shadow = await sharp({ create: { width: width + 2 * padding, height: height + 2 * padding, channels: 3, background: '#000' } })
    .joinChannel(mask).png().toBuffer()
  const foreground = await sharp(source)
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toBuffer()
  return sharp(shadow).composite([{ input: foreground }]).png().toBuffer()
}

export async function editedImage(file: string, settings: ImageEdits, seed: number, preview = false): Promise<Sharp> {
  const original = await dims(file)
  let { width, height } = original
  const scale = preview ? Math.min(1, 1200 / width, 900 / height) : 1
  const workWidth = Math.max(1, Math.round(width * scale))
  const workHeight = Math.max(1, Math.round(height * scale))
  const pixelSize = Math.max(1, Math.round(settings.pixelate * scale))
  let image: Sharp
  if (pixelSize > 1) {
    let source = sharp(file).rotate()
    if (preview) source = source.resize({ width: workWidth, height: workHeight, fit: 'fill' })
    const sourceBuffer = preview ? await source.png().toBuffer() : undefined
    const reduced = await (sourceBuffer ? sharp(sourceBuffer) : source)
      .resize({ width: Math.max(1, Math.round(workWidth / pixelSize)), height: Math.max(1, Math.round(workHeight / pixelSize)), fit: 'fill', kernel: 'nearest' })
      .png()
      .toBuffer()
    const pixelated = await sharp(reduced).resize({ width: workWidth, height: workHeight, fit: 'fill', kernel: 'nearest' }).png().toBuffer()
    image = sharp(pixelated)
  } else {
    image = sharp(file).rotate()
    if (preview) image.resize({ width: workWidth, height: workHeight, fit: 'fill' })
  }
  const blur = settings.blur * scale
  if (blur >= 0.3) image.blur(blur)
  image.modulate({ brightness: settings.brightness, saturation: settings.saturation, hue: settings.hue })
  if (settings.grayscale) image.greyscale()
  if (settings.sharpen > 0) image.sharpen({ sigma: settings.sharpen * scale })
  if (settings.noise > 0) {
    const tile = await noiseLayer(workWidth, workHeight, settings.noise, seed)
    image.composite([{ input: tile, blend: 'overlay' }])
  }
  if (settings.rotate) {
    // ponytail: 90° 배수가 아닌 각도는 빈 모서리가 투명 → JPG 출력이면 검정으로 채워질 수 있음
    image = sharp(await image.png().toBuffer()).rotate(settings.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    const rad = settings.rotate * Math.PI / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    width = Math.round(original.width * cos + original.height * sin)
    height = Math.round(original.width * sin + original.height * cos)
  }
  // 둥글기/여백 미리보기는 브라우저가 SVG로 그림 → 최종 출력에만 적용
  if (preview || (settings.radius <= 0 && settings.px <= 0 && settings.shadow === 'none' && !settings.background)) return image
  // sharp 파이프라인은 composite 1회, extend가 composite보다 먼저 실행됨 → 단계마다 버퍼로 확정
  let buffer: Buffer<ArrayBufferLike> = await image.png({ compressionLevel: 0 }).toBuffer()
  // 그림자 크기는 회전 전 원본 기준 (미리보기와 동일)
  const shortSide = Math.min(original.width, original.height)
  const shadowPadding = settings.shadow === 'none' ? 0 : shadowMetrics(shortSide, settings.shadow).padding
  const px = settings.px
  if (settings.inset) {
    const safeWidth = Math.max(1, width - 2 * (px + shadowPadding))
    const safeHeight = Math.max(1, height - 2 * (px + shadowPadding))
    buffer = await sharp(buffer).resize({ width: safeWidth, height: safeHeight, fit: 'inside' }).png().toBuffer()
  }
  const { width: contentWidth = width, height: contentHeight = height } = await sharp(buffer).metadata()
  const r = Math.min(Math.round(settings.radius * contentWidth / width), Math.floor(Math.min(contentWidth, contentHeight) / 2))
  if (r > 0) {
    const mask = `<svg width="${contentWidth}" height="${contentHeight}"><rect width="${contentWidth}" height="${contentHeight}" rx="${r}" ry="${r}"/></svg>`
    buffer = await sharp(buffer).ensureAlpha().composite([{ input: Buffer.from(mask), blend: 'dest-in' }]).png({ compressionLevel: 0 }).toBuffer()
  }
  if (settings.shadow !== 'none') buffer = await addShadow(buffer, shortSide, settings.shadow)
  if (px > 0) buffer = await sharp(buffer).ensureAlpha().extend({ top: px, bottom: px, left: px, right: px, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
  if (settings.inset) return sharp({ create: { width, height, channels: 4, background: settings.background ?? { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: buffer, gravity: 'centre' }])
  if (settings.background) return sharp(buffer).flatten({ background: settings.background })
  return sharp(buffer)
}

export function noiseSeed(): number {
  return randomBytes(4).readUInt32BE(0)
}
