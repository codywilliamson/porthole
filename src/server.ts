import { config } from './config'

// placeholder — will be replaced with real api + static serving
export function startServer() {
  const dist = new URL('../dist', import.meta.url)

  Bun.serve({
    hostname: config.host,
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname.startsWith('/api/')) {
        return new Response('not implemented', { status: 501 })
      }

      const path = url.pathname === '/' ? '/index.html' : url.pathname
      const file = Bun.file(new URL(`.${path}`, dist))
      if (await file.exists()) return new Response(file)

      return new Response('porthole — build the frontend first')
    },
  })

  console.log(`porthole listening on ${config.host}:${config.port}`)
}
