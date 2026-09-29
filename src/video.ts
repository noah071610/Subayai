import { spawn } from 'node:child_process'
import { rename, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { ext } from './files.js'
import { SkipError, UsageError, log, tty } from './ui.js'

interface Probe {
  vcodec: string
  acodec: string | null
  pixFmt: string
  transfer: string
  duration: number
}

function exec(cmd: string, args: string[], onLine?: (line: string) => void): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d: Buffer) => {
      const s = d.toString()
      out += s
      if (onLine) for (const l of s.split('\n')) onLine(l)
    })
    p.stderr.on('data', (d: Buffer) => (err += d.toString()))
    p.on('error', (e: NodeJS.ErrnoException) =>
      fail(e.code === 'ENOENT' ? new UsageError(`${cmd} not found. Install ffmpeg first (macOS: brew install ffmpeg).`) : e),
    )
    p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(err.trim().split('\n').slice(-3).join('\n') || `${cmd} exited ${code}`))))
  })
}

async function probe(file: string): Promise<Probe> {
  const raw = await exec('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,pix_fmt,color_transfer:format=duration',
    '-of', 'json', file,
  ])
  const j = JSON.parse(raw) as {
    streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; color_transfer?: string }[]
    format?: { duration?: string }
  }
  const v = j.streams?.find((s) => s.codec_type === 'video')
  const a = j.streams?.find((s) => s.codec_type === 'audio')
  if (!v?.codec_name) throw new SkipError('no video stream')
  return {
    vcodec: v.codec_name,
    acodec: a?.codec_name ?? null,
    pixFmt: v.pix_fmt ?? '',
    transfer: v.color_transfer ?? '',
    duration: Number(j.format?.duration) || 0,
  }
}

// aac면 그대로, 그 외(mov의 pcm 등)는 mp4 호환 aac로
const audioArgs = (p: Probe): string[] =>
  !p.acodec ? ['-an'] : p.acodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k']

const copyArgs = (p: Probe): string[] => ['-c:v', 'copy', ...(p.vcodec === 'hevc' ? ['-tag:v', 'hvc1'] : [])]

// h264 등 → x265 CRF 24 (화질 유지), 이미 hevc면 CRF 26 (재인코딩 이득 적음)
function x265Args(p: Probe): string[] {
  const hdr = p.transfer === 'smpte2084' || p.transfer === 'arib-std-b67'
  const params = ['log-level=error']
  const args = ['-c:v', 'libx265', '-crf', p.vcodec === 'hevc' ? '26' : '24', '-preset', 'slow', '-tag:v', 'hvc1']
  // 아이폰 HDR(HLG/PQ)을 8bit로 뽑으면 색이 물빠짐 → 10bit + bt2020 태그 유지
  if (hdr || p.pixFmt.includes('10')) args.push('-pix_fmt', 'yuv420p10le')
  if (hdr) {
    params.push('colorprim=bt2020', `transfer=${p.transfer}`, 'colormatrix=bt2020nc')
    args.push('-color_primaries', 'bt2020', '-color_trc', p.transfer, '-colorspace', 'bt2020nc')
  }
  return [...args, '-x265-params', params.join(':')]
}

async function ffmpeg(input: string, output: string, video: string[], p: Probe): Promise<void> {
  const name = basename(input)
  const show = tty.interactive && p.duration > 0
  let last = -1
  await exec(
    'ffmpeg',
    ['-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?', ...video, ...audioArgs(p), '-movflags', '+faststart', output],
    (line) => {
      const us = /^out_time_us=(\d+)/.exec(line)?.[1]
      if (!show || !us) return
      const pct = Math.min(99, Math.floor(Number(us) / 1e6 / p.duration * 100))
      if (pct !== last) process.stderr.write(`\r  ${name} ${(last = pct)}%`)
    },
  )
  if (show) process.stderr.write(`\r\x1b[K`)
}

export async function compressVideo(input: string, output: string): Promise<void> {
  const p = await probe(input)
  await ffmpeg(input, output, x265Args(p), p)
  if ((await stat(output)).size < (await stat(input)).size) return
  // 재인코딩 이득 없음 → 손실만 생긴 것. mp4면 그대로 두고, mov면 원본 스트림을 mp4로 복사
  if (ext(input) === 'mp4') throw new SkipError('no size gain, original kept')
  log(`  ${basename(input)}: no gain from re-encoding, copying original streams into mp4`)
  await ffmpeg(input, output, copyArgs(p), p)
}

// 기본은 remux(무손실, 즉시). mp4에 못 넣는 코덱(ProRes 등)만 x265로 인코딩
export async function movToMp4(input: string, output: string): Promise<void> {
  const p = await probe(input)
  const copyable = ['h264', 'hevc', 'av1', 'mpeg4'].includes(p.vcodec)
  if (!copyable) log(`  ${basename(input)}: ${p.vcodec} can't go in mp4 as-is, encoding to HEVC`)
  await ffmpeg(input, output, copyable ? copyArgs(p) : x265Args(p), p)
}

// mov → mp4 → compress (압축 이득 없으면 변환본 그대로). 그 외는 compress만 (mp4는 이득 없으면 SkipError)
export async function optimizeVideo(input: string, output: string): Promise<void> {
  if (ext(input) !== 'mov') return compressVideo(input, output)
  const intermediate = `${output}.movtomp4.mp4`
  try {
    await movToMp4(input, intermediate)
    try {
      await compressVideo(intermediate, output)
    } catch (e) {
      if (!(e instanceof SkipError)) throw e
      await rename(intermediate, output)
    }
  } finally {
    await rm(intermediate, { force: true })
  }
}
