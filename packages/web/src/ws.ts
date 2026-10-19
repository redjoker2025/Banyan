import { getToken } from './api'

export interface WsMessage {
  type: string
  payload: Record<string, unknown>
}

type WsHandler = (msg: WsMessage) => void

class WsClient {
  private ws: WebSocket | null = null
  private retry = 0
  private handlers = new Set<WsHandler>()
  connected = false
  onStateChange: ((connected: boolean) => void) | null = null

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(getToken())}`)
    this.ws = ws
    ws.onopen = () => {
      this.connected = true
      this.retry = 0
      this.onStateChange?.(true)
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as WsMessage
        this.handlers.forEach((h) => h(msg))
      } catch {
        // ignore malformed frames
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return // superseded by a newer socket
      this.connected = false
      this.onStateChange?.(false)
      const delay = Math.min(1000 * 2 ** this.retry++, 10_000)
      setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => ws.close()
  }

  subscribe(handler: WsHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }
}

export const wsClient = new WsClient()
