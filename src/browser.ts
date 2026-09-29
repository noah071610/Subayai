import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage } from 'node:http'

export interface Asset { type: string; data: Buffer }

async function readJson(req: IncomingMessage): Promise<unknown> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    // Rename plans may contain one entry per selected file.
    if (body.length > 1_000_000) throw new Error('Settings too large')
  }
  return JSON.parse(body) as unknown
}

// 로컬 편집 UI. GET / = page, routes = 미리보기 등, POST /apply → 값 반환, POST /cancel → null
// routes의 POST body는 parse를 통과한 값, GET은 null
export async function editInBrowser<T>(
  page: string,
  parse: (value: unknown) => T | null,
  routes: Record<string, (body: T | null) => Promise<Asset>> = {},
): Promise<T | null> {
  const token = randomBytes(32).toString('base64url')
  const browserPage = page.replace(
    '<head>',
    `<head><script>const fetchLocal=window.fetch.bind(window);window.fetch=(input,init={})=>{const headers=new Headers(init.headers);headers.set('X-Subayai-Token',${JSON.stringify(token)});return fetchLocal(input,{...init,headers})}</script>`,
  )
  let origin = ''
  let finish!: (value: T | null | Error) => void
  const result = new Promise<T | null>((resolve, reject) => {
    finish = (value) => (value instanceof Error ? reject(value) : resolve(value))
  })
  const server = createServer((req, res) => {
    const key = `${req.method} ${req.url}`
    if (key === 'GET /') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'DENY',
      }).end(browserPage)
      return
    }
    if (req.method === 'POST' && (req.headers.origin !== origin || req.headers['x-subayai-token'] !== token)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    if (key === 'POST /cancel') {
      res.writeHead(200).end('OK')
      server.close()
      finish(null)
      return
    }
    const route = routes[key]
    if (!route && key !== 'POST /apply') {
      res.writeHead(404).end('Not found')
      return
    }
    void (async () => {
      const body = req.method === 'POST' ? parse(await readJson(req)) : null
      if (req.method === 'POST' && body === null) {
        res.writeHead(400).end('Settings out of range')
        return
      }
      if (!route) {
        res.writeHead(200).end('OK')
        server.close()
        finish(body)
        return
      }
      const asset = await route(body)
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' }).end(asset.data)
    })().catch((error: unknown) => res.writeHead(400).end(error instanceof Error ? error.message : String(error)))
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not start the browser editor')
  origin = `http://127.0.0.1:${address.port}`
  const url = `${origin}/`
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const browser = spawn(command, args, { stdio: 'ignore', detached: true })
  browser.once('error', (error) => {
    server.close()
    finish(error)
  })
  browser.unref()
  return result
}
