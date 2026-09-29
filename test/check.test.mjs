// 빌드 후 실행: npm run build && npm test
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { outputPath } from '../dist/files.js'
import { parseColor } from '../dist/ui.js'
import { parsePlan } from '../dist/browser-rename.js'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
// HOME을 임시 폴더로: 실제 ~/.subayai/config.json의 "replace": "always"가 테스트에 영향 없게
const cliIn = (dir) => (...args) =>
  JSON.parse(execFileSync('node', [cli, ...args, '--json'], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME: dir } }))

test('parseColor', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, alpha: 1 })
  assert.deepEqual(parseColor('ff000080'), { r: 255, g: 0, b: 0, alpha: 128 / 255 })
  assert.deepEqual(parseColor('rgba(0, 128, 255, 0.5)'), { r: 0, g: 128, b: 255, alpha: 0.5 })
  assert.equal(parseColor('rgb(256,0,0)'), null)
  assert.equal(parseColor('nope'), null)
  assert.deepEqual(parseColor('Red'), { r: 255, g: 0, b: 0, alpha: 1 })
  assert.equal(parseColor('transparent'), null)
})

test('outputPath', () => {
  const o = { suffix: 'compress', outExt: 'webp', replace: false, keepSmaller: true }
  assert.equal(outputPath('/a/b.png', o), '/a/b_compress.webp')
  assert.equal(outputPath('/a/b.png', { ...o, replace: true }), '/a/b.webp')
  assert.equal(outputPath('/a/b.png', { ...o, suffix: '' }), '/a/b.webp')
})

test('edit shape / padding via CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'subayai-'))
  await sharp({ create: { width: 200, height: 100, channels: 4, background: '#f00' } }).png().toFile(join(dir, 'a.png'))
  const run = cliIn(dir)

  run('edit', 'a.png', '--radius', '16')
  const { data, info } = await sharp(join(dir, 'a_edited.png')).raw().toBuffer({ resolveWithObject: true })
  assert.equal(data[3], 0, 'corner is transparent')
  assert.equal(data[(50 * info.width + 100) * 4 + 3], 255, 'center is opaque')

  rmSync(join(dir, 'a_edited.png'))
  run('edit', 'a.png', '--px', '10')
  assert.deepEqual(await sharp(join(dir, 'a_edited.png')).metadata().then((m) => [m.width, m.height]), [220, 120])

  run('resize', 'a.png', '--percent', '50')
  assert.deepEqual(await sharp(join(dir, 'a_resized.png')).metadata().then((m) => [m.width, m.height]), [100, 50])

  // --all + 커스텀 가로가 더 크면 전체 취소
  assert.throws(() => run('resize', '--all', '--dir', dir, '--width', '500'))

  // -y: 결과가 원래 이름을 가져가고, 원본은 .subayai/<실행 시각>/ 에 보관
  run('edit', 'a.png', '--px', '2', '-y')
  assert.deepEqual(await sharp(join(dir, 'a.png')).metadata().then((m) => [m.width, m.height]), [204, 104])
  const [runDir] = readdirSync(join(dir, '.subayai')).filter((n) => n !== '.gitignore')
  assert.deepEqual(await sharp(join(dir, '.subayai', runDir, 'a.png')).metadata().then((m) => [m.width, m.height]), [200, 100])
  assert.equal(readFileSync(join(dir, '.subayai', '.gitignore'), 'utf8'), '*\n')
})

test('recolor (single-color png) via CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'subayai-recolor-'))
  const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`)
  await sharp(svg('<circle cx="50" cy="50" r="30" fill="#e11"/>')).png().toFile(join(dir, 'logo.png'))
  await sharp(svg('<circle cx="30" cy="50" r="20" fill="#e11"/><circle cx="70" cy="50" r="20" fill="#11e"/>')).png().toFile(join(dir, 'two.png'))
  const run = cliIn(dir)

  run('recolor', 'logo.png', '--color', '#0000ff')
  const src = await sharp(join(dir, 'logo.png')).raw().toBuffer()
  const out = await sharp(join(dir, 'logo_recolored.png')).raw().toBuffer()
  assert.deepEqual([...out.subarray((50 * 100 + 50) * 4, (50 * 100 + 50) * 4 + 4)], [0, 0, 255, 255])
  assert.equal(out[3], 0, 'transparent background remains transparent')
  // 안티앨리어싱 경계: 알파 그대로, 색만 교체
  const edge = [...Array(100).keys()].map((x) => (50 * 100 + x) * 4).find((i) => src[i + 3] > 0 && src[i + 3] < 250)
  assert.deepEqual([...out.subarray(edge, edge + 4)], [0, 0, 255, src[edge + 3]])

  // 2색 이상이면 실패
  assert.throws(() => run('recolor', 'two.png', '--color', '#000'))

  // 그라디언트: 로고 bbox 기준 → 왼쪽 끝은 첫 stop, 오른쪽 끝은 마지막 stop
  run('recolor', 'logo.png', '--gradient', '#00c6ff,#ee46bc', '-y')
  const grad = await sharp(join(dir, 'logo.png')).raw().toBuffer()
  const row = [...Array(100).keys()].map((x) => (50 * 100 + x) * 4).filter((i) => grad[i + 3] === 255)
  const near = (i, rgb) => assert.ok(rgb.every((v, k) => Math.abs(grad[i + k] - v) < 24), `${[...grad.subarray(i, i + 3)]} ≈ ${rgb}`)
  near(row[0], [0, 198, 255])
  near(row.at(-1), [238, 70, 188])
  assert.throws(() => run('recolor', 'logo.png', '--gradient', 'nope'))
  assert.throws(() => run('recolor', 'logo.png', '--gradient', '#ff0000,#0000ff', '--color', '#000'))
})

test('svg: recolor / responsive / convert / component via CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'subayai-svg-'))
  const icons = join(dir, 'icons')
  mkdirSync(icons)
  // 한 가지 색 (기본 검정 fill + <style>의 black stroke)
  writeFileSync(join(icons, 'arrow-left.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><!-- hi --><style>.a{stroke:black}</style><path class="a" stroke-width="2" d="M2 2h20v20H2z"/></svg>')
  // 여러 색 + gradient
  writeFileSync(join(icons, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="rgb(0,0,255)"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><circle cx="5" cy="5" r="2" fill="#0f0"/></svg>')
  const raster = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#e11' } }).png().toBuffer()
  writeFileSync(join(icons, 'raster.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image width="2" height="2" href="data:image/png;base64,${raster.toString('base64')}"/></svg>`)
  const run = cliIn(dir)

  run('svg', 'recolor', 'icons/logo.svg', '--color', 'white')
  const recolored = readFileSync(join(icons, 'logo_recolored.svg'), 'utf8')
  assert.doesNotMatch(recolored, /red|#0f0|rgb\(/)
  assert.match(recolored, /url\(#g\)/)

  run('svg', 'recolor', 'icons/raster.svg', '--color', '#00ff00')
  const rasterData = await sharp(join(icons, 'raster_recolored.svg')).raw().toBuffer()
  assert.deepEqual([...rasterData.subarray(0, 4)], [0, 255, 0, 255])

  // 그라디언트: 원본을 흰색 마스크로 → <style> stroke와 기본 fill까지 하나의 그라디언트
  run('svg', 'recolor', 'icons/arrow-left.svg', '--gradient', '#00c6ff,#ee46bc')
  const gradSvg = readFileSync(join(icons, 'arrow-left_recolored.svg'), 'utf8')
  assert.match(gradSvg, /<mask id="subayai-[0-9a-f]{8}-m">/)
  const { data: g, info } = await sharp(Buffer.from(gradSvg)).raw().toBuffer({ resolveWithObject: true })
  const at = (x, y) => [...g.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)]
  const [left, right] = [at(2, 12), at(21, 12)]
  assert.ok(left[3] === 255 && right[3] === 255 && left[2] > 240 && left[0] < 80 && right[0] > 180, `${left} → ${right}`)

  run('svg', 'responsive', 'icons/logo.svg')
  const responsive = readFileSync(join(icons, 'logo_responsive.svg'), 'utf8')
  assert.match(responsive, /viewBox="0 0 10 10"/)
  assert.doesNotMatch(responsive, /<svg[^>]*\swidth=/)

  run('convert', 'icons/logo.svg', '--to', 'png')
  assert.equal((await sharp(join(icons, 'logo.png')).metadata()).width, 10)

  writeFileSync(join(dir, 'package.json'), '{}')
  writeFileSync(join(dir, 'tsconfig.json'), '{}')
  run('component', '--dir', 'icons', '--out', 'src/graphics')
  const tsx = readFileSync(join(dir, 'src/graphics/icons-graphics.tsx'), 'utf8')
  const [arrow = '', logo = ''] = tsx.split('export const ').slice(1)
  assert.match(arrow, /^ArrowLeft = \(props: SVGProps<SVGSVGElement>\)/)
  assert.match(arrow, /currentColor/)
  assert.match(arrow, /strokeWidth=/)
  assert.match(arrow, /\{\.\.\.props\}/)
  assert.doesNotMatch(arrow, /<svg[^>]*\swidth=/)
  assert.doesNotMatch(logo, /currentColor/, 'multi-color SVG keeps its colors')
  assert.match(logo, /^Logo = \(\{ color1 = '#ff0000', color2 = '#0000ff', color3 = '#00ff00', \.\.\.props \}: SVGProps<SVGSVGElement> & \{ color1\?: string; color2\?: string; color3\?: string \}\)/)
  assert.match(logo, /stopColor=\{color1\}/)
  assert.match(logo, /fill=\{color3\}/)
  assert.match(logo, /id="logo__/, 'ids are prefixed')

  // 재실행: 전부 skip → exit 2
  assert.throws(() => run('component', '--dir', 'icons', '--out', 'src/graphics'), (e) => JSON.parse(e.stdout).skipped === 3)
})

test('rename via CLI without sort or position flags', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subayai-rename-'))
  const folder = join(dir, 'My Photos')
  mkdirSync(folder)
  for (const n of ['b.png', 'a.txt', 'c.jpg']) writeFileSync(join(folder, n), n)
  const run = cliIn(dir)
  const names = () => readdirSync(folder).sort()

  run('rename', '--dir', folder)
  assert.deepEqual(names(), ['my-photos-1.txt', 'my-photos-2.png', 'my-photos-3.jpg'])
  assert.equal(readFileSync(join(folder, 'my-photos-1.txt'), 'utf8'), 'a.txt')
  assert.throws(() => run('rename', '--dir', folder, '--sort', 'name'))
  assert.throws(() => run('rename', '--dir', folder, '--pos', 'suffix'))
  assert.throws(() => run('compress', 'a.png', '--percent', '50'))
})

test('rename browser plan validation', () => {
  const parse = parsePlan(['.png', '.PNG', '.jpg'])
  assert.deepEqual(parse({ names: ['ko-1', 'ko-2', 'ko-1'], middles: [], optimize: false }), { names: ['ko-1', 'ko-2', 'ko-1'], middles: [], optimize: false })
  assert.equal(parse({ names: ['ko-1', 'KO-1', 'x'], middles: [], optimize: false }), null, 'case-insensitive duplicate')
  assert.equal(parse({ names: ['a', 'b'], middles: [], optimize: false }), null, 'one name per file')
  assert.equal(parse({ names: ['a', '../b', 'c'], middles: [], optimize: false }), null, 'no paths')
  assert.equal(parse({ names: ['a', '.b', 'c'], middles: [], optimize: false }), null, 'no dotfiles')
  assert.equal(parse({ names: ['a', '', 'c'], middles: [], optimize: false }), null, 'no empty names')
  assert.equal(parse({ names: ['a', 'b', 'c'], middles: [1], optimize: false }), null, 'middles are strings')
  assert.equal(parse({ names: ['a', 'b', 'c'] }), null, 'optimize required')
})

test('sync: mirror with subfolders, png → webp, saved on first sync, nested out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'subayai-sync-'))
  mkdirSync(join(dir, 'raw/sub'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "x"\n}\n')
  await sharp({ create: { width: 64, height: 64, channels: 4, background: '#f00' } }).png().toFile(join(dir, 'raw/a.png'))
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0f0' } }).jpeg({ quality: 100 }).toFile(join(dir, 'raw/sub/b.jpg'))
  writeFileSync(join(dir, 'raw/sub/c.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!-- x --><rect width="1" height="1"/></svg>')
  await sharp({ create: { width: 64, height: 64, channels: 3, background: '#00f' } }).gif().toFile(join(dir, 'raw/d.gif'))
  const run = cliIn(dir)

  // 첫 sync 전엔 --watch 불가
  assert.throws(() => run('sync', '--dir', 'raw', '--out', 'public', '--watch'))
  assert.equal(run('sync', '--dir', 'raw', '--out', 'public').done, 4)
  assert.equal((await sharp(join(dir, 'public/a.webp')).metadata()).format, 'webp')
  assert.equal((await sharp(join(dir, 'public/sub/b.jpg')).metadata()).format, 'jpeg')
  assert.doesNotMatch(readFileSync(join(dir, 'public/sub/c.svg'), 'utf8'), /<!--/)
  assert.equal((await sharp(join(dir, 'public/d.gif')).metadata()).format, 'gif')
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).subayai, { sync: { dir: 'raw', out: 'public' } }, 'first sync saves the folders')

  // 재실행: 저장된 폴더로, 바뀐 파일만. 전부 최신이면 exit 0
  assert.equal(run('sync').done, 0)
  utimesSync(join(dir, 'raw/a.png'), new Date(), new Date(Date.now() + 5000))
  assert.deepEqual(run('sync').results.map((r) => r.output), ['public/a.webp'])

  // "componentOut"이 있으면 SVG → 폴더별 컴포넌트. 이미 있으면 조용히 skip
  const pkgJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkgJson, subayai: { ...pkgJson.subayai, componentOut: 'graphics' } }))
  assert.deepEqual(run('sync').results.map((r) => r.output), ['graphics/sub-graphics.jsx'])
  assert.match(readFileSync(join(dir, 'graphics/sub-graphics.jsx'), 'utf8'), /export const C = /)
  assert.equal(run('sync').results.length, 0)

  // out은 이미지 폴더 안에 둘 수 있음 (자기 결과는 다시 안 잡음). 이미지 폴더 자체나 그 부모는 불가
  assert.equal(run('sync', '--dir', 'raw', '--out', 'raw/optimized').done, 4)
  assert.equal(run('sync', '--dir', 'raw', '--out', 'raw/optimized').done, 0)
  assert.throws(() => run('sync', '--dir', 'raw', '--out', 'raw'))
  assert.throws(() => run('sync', '--dir', 'raw/sub', '--out', 'raw'))
})
