import { extname } from 'node:path'
import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import sharp, { type Sharp } from 'sharp'
import { editImageInBrowser, type EditAction } from './browser-edit.js'
import { editColorInBrowser } from './browser-color.js'
import { editedImage, DEFAULT_EDITS, noiseSeed, type ImageEdits } from './image-edit.js'
import { dims, ext, rel, type Dims, type Result } from './files.js'
import { canvas, gradientOf, solid, type Fill } from './gradient.js'
import { analyze, DEFAULT_TOLERANCE, MultiColorError, paint } from './recolor.js'
import { cutout } from './removebg.js'
import { renameFiles } from './rename.js'
import { colorsOf, component, optimizeSvg, paintSvg, responsiveSvg, transformSvg } from './svg.js'
import { askColor, askInt, choose, parseColor, SkipError, tty, UsageError, type Rgba } from './ui.js'
import { compressVideo, movToMp4, optimizeVideo } from './video.js'

export interface Flags {
  webp: boolean
  to?: string
  percent?: string
  width?: string
  height?: string
  px?: string
  radius?: string
  color?: string
  gradient?: string
  bg?: string
  out?: string
  brightness?: string
  saturation?: string
}

export interface Job {
  suffix: string // '' = 확장자만 바뀜 (a.png → a.webp)
  outExt: (input: string) => string
  keepSmaller?: boolean
  run: (input: string, output: string) => Promise<void>
}

interface Base {
  summary: string
  flags?: string
  options?: readonly string[]
  inputs: readonly string[]
  video?: boolean
  serial?: boolean // 무거운 작업(영상, API 요청)은 한 번에 하나씩
  all?: false // --all 금지할 명령어에 표시
  multi?: true // picker에서 space로 여러 파일/폴더 선택
}

// 파일 하나 → 결과 하나
interface JobCommand extends Base {
  prepare: (files: string[], f: Flags) => Promise<Job | null>
}

// 폴더 전체 → 결과 파일 하나 (항상 폴더 선택)
interface BundleCommand extends Base {
  bundle: (files: string[], f: Flags, dryRun: boolean) => Promise<Result[]>
}

// 폴더 → 다른 폴더로 미러링 (하위 폴더 포함). cli.ts + sync.ts가 처리
interface MirrorCommand extends Base {
  mirror: true
}

export type Command = JobCommand | BundleCommand | MirrorCommand

const IMG = ['jpg', 'jpeg', 'png', 'webp'] as const
const SVG = ['svg'] as const
const isSvg = (input: string): boolean => ext(input) === 'svg'
const VIDEO = ['mp4', 'mov', 'm4v'] as const
export const isVideo = (input: string): boolean => (VIDEO as readonly string[]).includes(ext(input))
const CONVERT_TO = ['jpg', 'png', 'webp', 'mp4'] as const
const CONVERT_FROM: Record<(typeof CONVERT_TO)[number], readonly string[]> = {
  jpg: ['png', 'gif', 'tif', 'tiff', 'psd', 'svg', 'webp'],
  png: ['jpg', 'jpeg', 'gif', 'tif', 'tiff', 'psd', 'svg', 'webp'],
  webp: ['jpg', 'jpeg', 'gif', 'tif', 'tiff', 'psd', 'svg', 'png'],
  mp4: ['mov'],
}
const CONVERT_INPUTS = [...new Set(Object.values(CONVERT_FROM).flat())]
const ALPHA: readonly string[] = ['png', 'webp']
const keep = (input: string): string => extname(input).slice(1)
const hasAlpha = (input: string): boolean => ALPHA.includes(keep(input).toLowerCase())

// small = iLoveIMG 스타일 압축 / high = 변환·편집용 고품질
// ponytail: 값은 출발점. iLoveIMG 결과 샘플과 비교해서 튜닝
export async function write(img: Sharp, outExt: string, q: 'small' | 'high', output: string): Promise<void> {
  switch (outExt.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      img.jpeg({ quality: q === 'small' ? 75 : 90, mozjpeg: true })
      break
    case 'png':
      if (q === 'small') img.png({ palette: true, quality: 70, effort: 10, compressionLevel: 9 })
      else img.png({ compressionLevel: 9 })
      break
    case 'webp':
      img.webp({ quality: q === 'small' ? 75 : 90, effort: 6 })
      break
    case 'gif':
      // 최고 품질: 기존 팔레트 재사용 + 프레임 간 무손실(interFrameMaxError 0), 최대 effort로 크기만 줄임
      img.gif({ effort: 10 })
      break
    default:
      throw new Error(`Unsupported output format: ${outExt}`)
  }
  await img.toFile(output)
}

// rotate(): EXIF 회전을 픽셀에 반영 (메타데이터는 출력 시 제거되므로)
export const load = (file: string): Sharp => sharp(file).rotate()
// 압축용: gif/webp는 애니메이션 프레임 전부 유지 (load는 첫 프레임만). EXIF 회전은 jpg/png만 해당
export const loadAll = (file: string): Sharp => (['gif', 'webp'].includes(ext(file)) ? sharp(file, { animated: true }) : load(file))

function decodePsd(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('magick', [`${file}[0]`, 'png:-'])
    const chunks: Buffer[] = []
    let error = ''
    p.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    p.stderr.on('data', (chunk: Buffer) => (error += chunk.toString()))
    p.on('error', (e: NodeJS.ErrnoException) => reject(
      e.code === 'ENOENT' ? new UsageError('PSD conversion needs ImageMagick (magick). Install it first.') : e,
    ))
    p.on('close', (code) => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(error.trim() || `magick exited ${code}`)))
  })
}

type Plan = (d: Dims) => { width: number; height?: number }

// null = 리사이즈 안 함 (keepSize 허용 시: 메뉴 "Keep original size" 또는 --percent 100)
async function askResize(files: string[], f: Flags, keepSize = false): Promise<Plan | null> {
  const batch = files.length > 1
  const first = files.length === 1 && files[0] ? await dims(files[0]) : null
  if (f.percent !== undefined && (f.width !== undefined || f.height !== undefined)) throw new UsageError('Pass --percent or --width [--height], not both')
  if (f.height !== undefined && f.width === undefined) throw new UsageError('--height requires --width')
  if (f.percent === undefined && f.width === undefined && !tty.interactive) {
    throw new UsageError(`Missing --percent <1-${keepSize ? 100 : 99}> or --width <px> [--height <px>]${keepSize ? ' (--percent 100 keeps the original size)' : ''}`)
  }
  const mode = f.width !== undefined ? 'custom' : f.percent !== undefined ? 'percent' : await choose('percent', undefined, 'Resize to', [
    { value: '25', name: '25%' },
    { value: '50', name: '50%' },
    { value: '75', name: '75%' },
    { value: 'custom', name: 'Custom size' },
    ...(keepSize ? [{ value: '100', name: 'Keep original size' }] : []),
  ])

  if (mode !== 'custom') {
    const p = mode === 'percent' ? await askInt('percent', f.percent, 'Percent') : Number(mode)
    if (keepSize && p === 100) return null
    if (p >= 100) throw new UsageError(`--percent must be ${keepSize ? '100 or below' : 'below 100'}`)
    return (d) => ({ width: Math.max(1, Math.round((d.width * p) / 100)), height: Math.max(1, Math.round((d.height * p) / 100)) })
  }

  // 폴더 전체에 가로세로 고정값을 주면 비율 다른 이미지가 전부 찌그러짐 → 금지
  if (batch && f.height !== undefined) throw new UsageError('--all with both --width and --height would distort images. Use --percent or --width only.')
  const keepRatio = batch || f.width !== undefined
    ? f.height === undefined
    : (await choose('keep', undefined, 'Keep aspect ratio?', [
        { value: 'yes', name: 'Yes, set width only' },
        { value: 'no', name: 'No, set width and height' },
      ])) === 'yes'
  const width = await askInt('width', f.width, `Width in px${first ? ` (current ${first.width})` : ''}`)
  const height = keepRatio ? undefined : await askInt('height', f.height, `Height in px${first ? ` (current ${first.height})` : ''}`)

  // --all + 커스텀: 목표보다 작은 이미지가 하나라도 있으면 전체 취소
  if (batch) {
    const small = (await Promise.all(files.map(async (file) => ({ file, d: await dims(file) })))).filter((x) => x.d.width < width)
    if (small.length) {
      throw new UsageError(`Cancelled: ${small.length} image(s) are narrower than ${width}px\n  ${small.map((x) => `${rel(x.file)} (${x.d.width}px)`).join('\n  ')}`)
    }
  }
  return () => (height === undefined ? { width } : { width, height })
}

const resized = async (file: string, plan: Plan | null): Promise<Sharp> => (plan ? load(file).resize({ ...plan(await dims(file)), fit: 'fill' }) : load(file))

async function askEdits(file: string, f: Flags): Promise<{ settings: ImageEdits; seed: number; action: EditAction } | null> {
  const value = (flag: 'brightness' | 'saturation', text: string | undefined, max: number): number | undefined => {
    if (text === undefined) return undefined
    const n = Number(text)
    if (!Number.isFinite(n) || n < 0 || n > max) throw new UsageError(`--${flag} must be between 0 and ${max}`)
    return n
  }
  const brightness = value('brightness', f.brightness, 2)
  const saturation = value('saturation', f.saturation, 3)
  const radius = f.radius === undefined ? undefined : await askInt('radius', f.radius, 'Corner radius in px', 0)
  const px = f.px === undefined ? undefined : await askInt('px', f.px, 'Padding in px', 0)
  const settings = { ...DEFAULT_EDITS, brightness: brightness ?? 1, saturation: saturation ?? 1, radius: radius ?? 0, px: px ?? 0 }
  // 플래그가 하나라도 있으면 에디터 없이 바로 적용 (빠진 값은 기본값)
  if ([brightness, saturation, radius, px].some((v) => v !== undefined)) return { settings, seed: noiseSeed(), action: 'edit' }
  if (!tty.interactive) throw new UsageError('Pass at least one of --brightness <0-2>, --saturation <0-3>, --radius <px>, --px <n> in non-interactive mode.')
  return editImageInBrowser(file, settings)
}

function bgColor(f: Flags): Rgba {
  if (f.bg === undefined) return { r: 255, g: 255, b: 255, alpha: 1 }
  const c = parseColor(f.bg)
  if (!c) throw new UsageError(`Invalid --bg "${f.bg}"`)
  return c
}

// --gradient는 쉼표로 구분한 두 hex 색상
async function askFill(f: Flags, message: string): Promise<Fill> {
  if (f.gradient === undefined) return askColor('color', f.color, message)
  if (f.color !== undefined) throw new UsageError('Pass either --color or --gradient, not both')
  return gradientOf(f.gradient)
}

// 대화형에서는 브라우저 팔레트, 비대화형이나 --gradient면 플래그를 사용
async function askSvgFill(file: string, f: Flags): Promise<Fill | null> {
  if (!tty.interactive || f.gradient !== undefined) return askFill(f, 'New SVG color')
  const svg = await readFile(file, 'utf8')
  const initial = f.color !== undefined
    ? await askColor('color', f.color, 'New SVG color')
    : parseColor(colorsOf(svg).values().next().value ?? 'black')
  if (!initial) throw new UsageError('Could not read an SVG color')
  const preview = async (fill: Fill) => ({ type: 'image/svg+xml', data: Buffer.from(paintSvg(svg, fill)) })
  return editColorInBrowser('Recolor SVG', initial, await preview(initial), preview)
}

// 단색 로고 색 바꾸기. 대화형이면 첫 파일로 미리보기 (단색이 아니면 에디터 열기 전에 실패)
async function askLogoFill(files: string[], f: Flags, tolerance: number): Promise<Fill | null> {
  if (!tty.interactive || f.gradient !== undefined) return askFill(f, 'New color')
  const first = files[0]
  if (!first) throw new UsageError('Pick an image to recolor')
  // 여러 파일이면 첫 파일이 실패해도 나머지는 파일별로 처리
  const a = await analyze(first, tolerance).catch((e: unknown) => {
    if (files.length > 1 && e instanceof MultiColorError) return null
    throw e
  })
  const initial = f.color !== undefined
    ? await askColor('color', f.color, 'New color')
    : a ? { r: a.color[0], g: a.color[1], b: a.color[2], alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 1 }
  const fit = (img: Sharp) => img.resize({ width: 1400, height: 900, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const preview = async (fill: Fill) => ({ type: 'image/png', data: await fit(a ? paint(a, fill) : load(first)) })
  return editColorInBrowser('Recolor logo', initial, await preview(initial), preview)
}

async function foreground(input: string): Promise<Buffer> {
  if (!(await sharp(input).stats()).isOpaque) return sharp(input).rotate().png().toBuffer()
  return cutout(input)
}

async function askBackgroundFill(files: string[], f: Flags): Promise<{ fill: Fill; previewFile: string; previewCutout?: Buffer } | null> {
  const first = files[0]
  if (!first) throw new UsageError('Pick an image to change the background')
  if (!tty.interactive || f.gradient !== undefined) return { fill: await askFill(f, 'New background color (hex or rgba)'), previewFile: first }
  const initial = f.color === undefined ? { r: 255, g: 255, b: 255, alpha: 1 } : await askColor('color', f.color, 'New background color (hex or rgba)')
  const initialPreview = {
    type: 'image/png',
    data: await sharp(first).rotate().resize({ width: 1400, height: 900, fit: 'inside', withoutEnlargement: true }).png().toBuffer(),
  }
  let previewCutout: Buffer | undefined = !(await sharp(first).stats()).isOpaque
    ? await sharp(first).rotate().png().toBuffer()
    : undefined
  const preview = async (fill: Fill) => {
    if (!previewCutout) return initialPreview
    const foreground = await sharp(previewCutout).resize({ width: 1400, height: 900, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    const { width = 1, height = 1 } = await sharp(foreground).metadata()
    const data = await canvas(fill, width, height).composite([{ input: foreground }]).png().toBuffer()
    return { type: 'image/png', data }
  }
  const fill = await editColorInBrowser('Change image background', initial, initialPreview, preview, async () => {
    previewCutout = previewCutout ?? await foreground(first)
  })
  return fill && { fill, previewFile: first, previewCutout }
}

export const COMMANDS: Record<string, Command> = {
  compress: {
    summary: 'Compress images, GIFs and videos (--webp converts images to webp)',
    flags: '[--webp]',
    options: ['webp'],
    multi: true,
    inputs: [...IMG, 'gif', ...VIDEO],
    serial: true,
    prepare: async (files, f) => {
      if (f.webp && files.every(isVideo)) throw new UsageError('--webp only works with images')
      const outExt = (i: string): string => (isVideo(i) ? 'mp4' : f.webp ? 'webp' : keep(i))
      return {
        suffix: 'compress',
        outExt,
        run: async (i, o) => {
          if (isVideo(i)) return compressVideo(i, o)
          await write(loadAll(i), outExt(i), 'small', o)
          if ((await stat(o)).size >= (await stat(i)).size) throw new SkipError('no size gain, original kept')
        },
      }
    },
  },
  convert: {
    summary: 'Convert images to JPG, PNG or WebP; convert MOV to MP4',
    flags: '--to jpg|png|webp|mp4 [--bg <color>]',
    options: ['to', 'bg'],
    inputs: CONVERT_INPUTS,
    serial: true,
    prepare: async (files, f) => {
      const targets = CONVERT_TO.filter((to) => files.every((file) => CONVERT_FROM[to].includes(ext(file))))
      if (!targets.length) throw new UsageError('No single output format can convert every selected file.')
      const to = await choose('to', f.to, 'Convert to', targets.map((value) => ({ value, name: `Convert to ${value.toUpperCase()}` })))
      if (f.bg !== undefined && to !== 'jpg') throw new UsageError('--bg only works with --to jpg')
      const bg = to === 'jpg' ? bgColor(f) : undefined
      return {
        suffix: '',
        outExt: () => to,
        run: async (i, o) => {
          if (to === 'mp4') return movToMp4(i, o)
          const img = ext(i) === 'psd' ? sharp(await decodePsd(i)).rotate() : load(i)
          await write(bg ? img.flatten({ background: bg }) : img, to, 'high', o)
        },
      }
    },
  },
  edit: {
    summary: 'Edit color, effects, shape, shadow and padding in a browser editor',
    flags: '[--brightness 0-2] [--saturation 0-3] [--radius <px>] [--px <n>]',
    options: ['brightness', 'saturation', 'radius', 'px'],
    inputs: IMG,
    prepare: async (files, f) => {
      const input = files[0]
      if (!input) throw new UsageError('Pick an image to edit')
      const edit = await askEdits(input, f)
      if (!edit) return null
      const { settings, seed, action } = edit
      const plan = action === 'resize' || action === 'optimize' ? await askResize([input], f, action === 'optimize') : null
      const transparent = !settings.background && (settings.radius > 0 || settings.px > 0 || settings.shadow !== 'none')
      const outExt = (i: string): string => action === 'optimize' ? 'webp' : transparent && !hasAlpha(i) ? 'png' : keep(i)
      const edited = (i: string) => editedImage(i, settings, seed)
      const suffix = action === 'resize' ? 'resized' : action === 'optimize' ? 'optimized' : action === 'compress' ? 'compress' : 'edited'
      return {
        suffix,
        outExt,
        keepSmaller: action === 'compress',
        run: async (i, o) => {
          let image = await edited(i)
          if (action === 'resize' || action === 'optimize') {
            const size = plan?.(await dims(i))
            if (size) image = image.resize({ ...size, fit: 'fill' })
          }
          await write(image, outExt(i), action === 'compress' || action === 'optimize' ? 'small' : 'high', o)
        },
      }
    },
  },
  resize: {
    summary: 'Resize by percent or to a custom size',
    flags: '--percent <n> | --width <px> [--height <px>]',
    options: ['percent', 'width', 'height'],
    multi: true,
    inputs: IMG,
    prepare: async (files, f) => {
      const plan = await askResize(files, f)
      return { suffix: 'resized', outExt: keep, run: async (i, o) => write(await resized(i, plan), keep(i), 'high', o) }
    },
  },
  optimize: {
    summary: 'Images: resize + compress to WebP. SVG: minify. Videos: convert MOV to MP4, then compress',
    flags: '--percent <n> | --width <px> [--height <px>]  (images only, --percent 100 = no resize)',
    options: ['percent', 'width', 'height'],
    multi: true,
    inputs: [...IMG, ...SVG, ...VIDEO],
    serial: true,
    prepare: async (files, f) => {
      const images = files.filter((i) => !isSvg(i) && !isVideo(i))
      if (!images.length && (f.percent !== undefined || f.width !== undefined || f.height !== undefined)) {
        throw new UsageError('Resize flags only work with images')
      }
      const plan = images.length ? await askResize(images, f, true) : null
      return {
        suffix: 'optimized',
        outExt: (i) => (isVideo(i) ? 'mp4' : isSvg(i) ? 'svg' : 'webp'),
        run: async (i, o) => {
          if (isVideo(i)) return optimizeVideo(i, o)
          if (isSvg(i)) return transformSvg(i, o, optimizeSvg)
          return write(await resized(i, plan), 'webp', 'small', o)
        },
      }
    },
  },
  recolor: {
    summary: 'Recolor a single-color PNG/WebP logo or icon (keeps transparency and smooth edges)',
    flags: '[--color <hex|rgba()|name> | --gradient <#hex1,#hex2>]',
    options: ['color', 'gradient'],
    inputs: ALPHA,
    prepare: async (files, f) => {
      const fill = await askLogoFill(files, f, DEFAULT_TOLERANCE)
      if (!fill) return null
      return { suffix: 'recolored', outExt: keep, run: async (i, o) => write(paint(await analyze(i), fill), keep(i), 'high', o) }
    },
  },
  'svg recolor': {
    summary: 'Recolor an SVG in the browser color studio',
    flags: '[--color <hex|rgba()|name> | --gradient <#hex1,#hex2>]',
    options: ['color', 'gradient'],
    inputs: SVG,
    prepare: async (files, f) => {
      const input = files[0]
      if (!input) throw new UsageError('Pick an SVG to recolor')
      const fill = await askSvgFill(input, f)
      if (!fill) return null
      return { suffix: 'recolored', outExt: () => 'svg', run: (i, o) => transformSvg(i, o, (s) => paintSvg(s, fill)) }
    },
  },
  'svg responsive': {
    summary: 'Remove SVG width/height, keep viewBox only (scales with its container)',
    multi: true,
    inputs: SVG,
    prepare: async () => ({ suffix: 'responsive', outExt: () => 'svg', run: (i, o) => transformSvg(i, o, responsiveSvg) }),
  },
  component: {
    summary: 'Turn every SVG in a folder into React components (<folder>-graphics.tsx)',
    flags: '[--out <folder>]',
    options: ['out'],
    inputs: SVG,
    bundle: component,
  },
  sync: {
    summary: 'Mirror the image folder (with subfolders) into an output folder, compressed: PNG to WebP, MOV to MP4, the rest keep their format',
    flags: '[--out <folder>] [--watch]  (the first sync saves both folders to package.json; --watch needs that)',
    options: ['out', 'watch'],
    inputs: [...IMG, ...SVG, 'gif', ...VIDEO],
    mirror: true,
  },
  rename: {
    summary: 'Rename every file in a folder to <folder-name>-1, -2, ... (interactive editor: drag to reorder and group files)',
    inputs: ['*'],
    bundle: renameFiles,
  },
  removebg: {
    summary: 'Remove the background with iLoveAPI',
    multi: true,
    inputs: IMG,
    serial: true,
    prepare: async () => {
      const outExt = (i: string): string => (hasAlpha(i) ? keep(i) : 'png')
      return {
        suffix: 'nobg',
        outExt,
        run: async (i, o) => {
          await write(sharp(await cutout(i)), outExt(i), 'high', o)
        },
      }
    },
  },
  changebg: {
    summary: 'Preview and change an image background color or gradient (iLoveAPI)',
    flags: '[--color <hex|rgba()> | --gradient <#hex1,#hex2>]',
    options: ['color', 'gradient'],
    multi: true,
    inputs: IMG,
    serial: true,
    prepare: async (files, f) => {
      const selection = await askBackgroundFill(files, f)
      if (!selection) return null
      return {
        suffix: 'bg',
        outExt: keep,
        run: async (i, o) => {
          const data = i === selection.previewFile && selection.previewCutout ? selection.previewCutout : await foreground(i)
          const { width = 0, height = 0 } = await sharp(data).metadata()
          const bg = await canvas(selection.fill, width, height)
            .composite([{ input: data }])
            .png({ compressionLevel: 0 })
            .toBuffer()
          const img = sharp(bg)
          await write(hasAlpha(i) ? img : img.flatten({ background: solid(selection.fill) }), keep(i), 'high', o)
        },
      }
    },
  },
}

// 결과물(a_compress.png 등)은 picker / --all 대상에서 제외
export const DERIVED = /_(compress|resized|optimized|rounded|padded|nobg|bg|recolored|responsive|edited)$/
