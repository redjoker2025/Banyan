const TOKEN_KEY = 'banyan.token'

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly parties?: string[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function getToken(): string {
  let token = localStorage.getItem(TOKEN_KEY) ?? ''
  if (!token) {
    const q = new URLSearchParams(location.search)
    token = q.get('token') ?? ''
    if (token) {
      localStorage.setItem(TOKEN_KEY, token)
      q.delete('token')
      const qs = q.toString()
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash)
    }
  }
  return token
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim())
}

export async function api<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${getToken()}`)
  let body = init?.body
  if (init?.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(path, { ...init, headers, body })
  if (res.status === 401) {
    throw new ApiError('E_UNAUTHORIZED', 'missing or invalid token')
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string; parties?: string[] }
    throw new ApiError(err.error ?? 'E_INTERNAL', err.message ?? res.statusText, err.parties)
  }
  return (await res.json()) as T
}
