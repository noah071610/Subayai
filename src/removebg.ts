import { createHmac } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { password } from '@inquirer/prompts'
import { LimitError, UsageError, tty } from './ui.js'

const configPath = join(homedir(), '.subayai', 'config.json')
const tool = 'removebackgroundimage'
type Keys = { publicKey: string; secretKey: string }

async function keys(): Promise<Keys> {
  const config = existsSync(configPath) ? JSON.parse(await readFile(configPath, 'utf8')) as { iloveapi?: Partial<Keys> } : {}
  let { publicKey, secretKey } = config?.iloveapi ?? {}
  if (typeof publicKey !== 'string') publicKey = undefined
  if (typeof secretKey !== 'string') secretKey = undefined
  if (publicKey?.trim() && secretKey?.trim()) return { publicKey, secretKey }
  if (!tty.interactive) throw new UsageError(`iLoveAPI keys are required. Run interactively to save them in ${configPath}.`)
  if (!publicKey?.trim()) publicKey = await password({ message: 'iLoveAPI public key', mask: '*', validate: (v) => Boolean(v.trim()) || 'Enter your public key' })
  if (!secretKey?.trim()) secretKey = await password({ message: 'iLoveAPI secret key', mask: '*', validate: (v) => Boolean(v.trim()) || 'Enter your secret key' })
  await mkdir(join(homedir(), '.subayai'), { recursive: true, mode: 0o700 })
  await writeFile(configPath, JSON.stringify({ ...config, iloveapi: { publicKey, secretKey } }, null, 2) + '\n', { mode: 0o600 })
  await chmod(configPath, 0o600)
  return { publicKey, secretKey }
}

function token({ publicKey, secretKey }: Keys): string {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: '', aud: '', iat: now, nbf: now, exp: now + 3600, jti: publicKey })}`
  return `${body}.${createHmac('sha256', secretKey).update(body).digest('base64url')}`
}

async function checked(response: Response): Promise<Response> {
  if (response.ok) return response
  const body: unknown = await response.json().catch(() => null)
  const error = body && typeof body === 'object' && 'error' in body ? body.error : body
  const message = typeof error === 'string' ? error : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : response.statusText
  const detail = message || `HTTP ${response.status}`
  if (response.status === 402 || response.status === 429 || /credit|quota|limit|exceed/i.test(JSON.stringify(error))) {
    throw new LimitError(`iLoveAPI usage limit exceeded: ${detail}`)
  }
  throw new Error(`iLoveAPI request failed (HTTP ${response.status}): ${detail}`)
}

export async function cutout(file: string): Promise<Buffer> {
  const headers = { Authorization: `Bearer ${token(await keys())}` }
  const start = await checked(await fetch(`https://api.ilovepdf.com/v1/start/${tool}`, { headers }))
  const { server, task } = await start.json() as { server: string; task: string }
  if (!/^[a-z0-9-]+\.ilove(?:pdf|img)\.com$/.test(server) || !task) {
    throw new Error(`iLoveAPI returned an unsupported task server: ${String(server)}`)
  }
  const base = `https://${server}/v1`
  const form = new FormData()
  form.set('task', task)
  form.set('file', new Blob([new Uint8Array(await readFile(file))]), basename(file))
  const upload = await checked(await fetch(`${base}/upload`, { method: 'POST', headers, body: form }))
  const { server_filename } = await upload.json() as { server_filename: string }
  if (!server_filename) throw new Error('iLoveAPI returned no uploaded file')
  await checked(await fetch(`${base}/process`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, tool, files: [{ server_filename, filename: basename(file) }] }),
  }))
  const download = await checked(await fetch(`${base}/download/${encodeURIComponent(task)}`, { headers }))
  return Buffer.from(await download.arrayBuffer())
}
