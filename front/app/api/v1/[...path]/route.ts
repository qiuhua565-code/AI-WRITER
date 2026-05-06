import { NextRequest } from 'next/server'

// Edge Runtime: zero-buffer streaming, works in both dev and prod
export const runtime = 'edge'

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000'

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  const url = `${BACKEND}/api/v1/${path.join('/')}${req.nextUrl.search}`

  const headers = new Headers()
  const auth = req.headers.get('authorization')
  const ct = req.headers.get('content-type')
  const lastEventId = req.headers.get('last-event-id')
  if (auth) headers.set('authorization', auth)
  if (ct) headers.set('content-type', ct)
  if (lastEventId) headers.set('last-event-id', lastEventId)

  const pathStr = path.join('/')
  // 任务写作等用 GET /stream；对话用 POST /chat/sessions/:id/stream。二者都需禁用压缩、禁用缓存，
  // 否则 Edge 向上游 fetch 可能走 gzip + chunked，长 SSE 易出现 net::ERR_INCOMPLETE_CHUNKED_ENCODING。
  const isSseStream =
    pathStr.endsWith('/stream') && (req.method === 'GET' || req.method === 'POST')
  if (isSseStream) {
    headers.set('cache-control', 'no-store')
    headers.set('accept-encoding', 'identity')
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: isSseStream ? 'no-store' : undefined,
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    init.body = await req.arrayBuffer()
  }

  const upstream = await fetch(url, init)

  const resHeaders = new Headers()
  upstream.headers.forEach((v, k) => {
    // skip headers that cause issues in edge runtime
    if (['content-encoding', 'transfer-encoding'].includes(k.toLowerCase())) return
    resHeaders.set(k, v)
  })

  if (isSseStream) {
    resHeaders.set('Cache-Control', 'no-store')
    resHeaders.set('X-Accel-Buffering', 'no')
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  })
}

export const GET    = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => proxy(req, ctx)
export const POST   = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => proxy(req, ctx)
export const PUT    = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => proxy(req, ctx)
export const PATCH  = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => proxy(req, ctx)
export const DELETE = (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => proxy(req, ctx)
