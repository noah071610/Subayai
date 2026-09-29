import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'

test('iLoveAPI background removal and limit handling', async () => {
  const home = mkdtempSync(join(tmpdir(), 'subayai-api-'))
  const previousHome = process.env.HOME
  const previousFetch = globalThis.fetch
  process.env.HOME = home
  const { cutout } = await import('../dist/removebg.js')
  const { COMMANDS } = await import('../dist/commands.js')
  const source = join(home, 'input.png')
  const cutoutPng = await sharp(Buffer.from([0, 0, 0, 0, 255, 0, 0, 255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()
  await sharp({ create: { width: 2, height: 1, channels: 4, background: 'white' } }).png().toFile(source)
  mkdirSync(join(home, '.subayai'))
  writeFileSync(join(home, '.subayai', 'config.json'), JSON.stringify({ iloveapi: { publicKey: 'public', secretKey: 'secret' } }))

  try {
    const calls = []
    globalThis.fetch = async (url, init = {}) => {
      calls.push(String(url))
      const jwt = init.headers.Authorization.slice(7)
      const [header, payload, signature] = jwt.split('.')
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).jti, 'public')
      assert.equal(signature, createHmac('sha256', 'secret').update(`${header}.${payload}`).digest('base64url'))
      if (calls.length % 4 === 1) return Response.json({ server: 'api11.ilovepdf.com', task: 'task-1' })
      if (calls.length % 4 === 2) {
        assert.equal(init.body.get('task'), 'task-1')
        assert.equal(init.body.get('file').name, 'input.png')
        return Response.json({ server_filename: 'server.png' })
      }
      if (calls.length % 4 === 3) {
        assert.deepEqual(JSON.parse(init.body), { task: 'task-1', tool: 'removebackgroundimage', files: [{ server_filename: 'server.png', filename: 'input.png' }] })
        return Response.json({ status: 'TaskSuccess' })
      }
      return new Response(cutoutPng)
    }

    assert.deepEqual(await cutout(source), cutoutPng)
    const job = await COMMANDS.changebg.prepare([source], { color: '#00ff00' })
    const output = join(home, 'output.png')
    await job.run(source, output)
    const pixels = await sharp(output).raw().toBuffer()
    assert.deepEqual([...pixels.subarray(0, 3)], [0, 255, 0])
    assert.deepEqual([...pixels.subarray(4, 7)], [255, 0, 0])
    assert.deepEqual(calls.map((url) => new URL(url).pathname), [
      '/v1/start/removebackgroundimage', '/v1/upload', '/v1/process', '/v1/download/task-1',
      '/v1/start/removebackgroundimage', '/v1/upload', '/v1/process', '/v1/download/task-1',
    ])

    // 그라디언트 배경. 전경 픽셀은 그대로
    const gradJob = await COMMANDS.changebg.prepare([source], { gradient: '#00c6ff,#ee46bc' })
    await gradJob.run(source, output)
    const grad = await sharp(output).raw().toBuffer()
    assert.ok(grad[2] > 200 && grad[0] < 120, `blue-ish gradient start, got ${[...grad.subarray(0, 3)]}`)
    assert.deepEqual([...grad.subarray(4, 7)], [255, 0, 0])

    calls.length = 0
    globalThis.fetch = async () => {
      calls.push('start')
      return Response.json({ error: { message: 'Monthly credit limit exceeded' } }, { status: 402 })
    }
    await assert.rejects(cutout(source), /iLoveAPI usage limit exceeded: Monthly credit limit exceeded/)
    assert.equal(calls.length, 1)

    rmSync(join(home, '.subayai', 'config.json'))
    await assert.rejects(cutout(source), /iLoveAPI keys are required/)
    assert.equal(calls.length, 1)
    const cli = spawnSync(process.execPath, [new URL('../dist/cli.js', import.meta.url).pathname, 'removebg', source, '--json'], { env: { ...process.env, HOME: home }, encoding: 'utf8' })
    assert.equal(cli.status, 1)
    assert.match(JSON.parse(cli.stdout).results[0].reason, /iLoveAPI keys are required/)
  } finally {
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
