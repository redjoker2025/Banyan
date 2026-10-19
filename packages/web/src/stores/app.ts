import { defineStore } from 'pinia'
import { api, ApiError } from '../api'
import { wsClient, type WsMessage } from '../ws'

export interface NoteEntry {
  path: string
  type: 'file' | 'dir'
}

export interface SearchHit {
  path: string
  title: string
  snippet?: string
}

export type SaveState = 'saved' | 'saving' | 'dirty' | 'error'

const AUTOSAVE_DELAY = 800 // ms, per M1 spec (≤ 800ms)

export const useAppStore = defineStore('app', {
  state: () => ({
    vaultPath: null as string | null,
    files: [] as NoteEntry[],
    currentPath: null as string | null,
    /** editor content (source of truth for the editor pane) */
    content: '',
    /** last persisted baseline; dirty = content !== baseline */
    baseline: '',
    /** bumped whenever content is replaced from outside (open / remote sync) */
    contentRev: 0,
    saveState: 'saved' as SaveState,
    connected: false,
    needsToken: false,
    searchQuery: '',
    searchHits: [] as SearchHit[],
    searching: false,
    rightPanel: null as string | null,
    /** autosave timer handle */
    saveTimer: 0,
  }),

  getters: {
    dirty: (s) => s.content !== s.baseline,
  },

  actions: {
    async boot() {
      wsClient.onStateChange = (connected) => {
        this.connected = connected
      }
      wsClient.subscribe((msg) => this.onWsMessage(msg))
      wsClient.connect()
      try {
        const v = await api<{ path: string | null }>('/api/vault')
        this.vaultPath = v.path
        if (v.path) await this.loadTree()
      } catch (e) {
        if (e instanceof ApiError && e.code === 'E_UNAUTHORIZED') this.needsToken = true
      }
    },

    async openVault(folder: string) {
      const v = await api<{ path: string }>('/api/vault', { method: 'POST', json: { path: folder } })
      this.vaultPath = v.path
      this.currentPath = null
      this.content = ''
      this.baseline = ''
      await this.loadTree()
    },

    async loadTree() {
      if (!this.vaultPath) return
      const t = await api<{ items: NoteEntry[] }>('/api/tree')
      this.files = t.items
    },

    async openNote(rel: string) {
      if (this.dirty && this.currentPath) await this.saveNow()
      const n = await api<{ path: string; content: string }>(`/api/note?path=${encodeURIComponent(rel)}`)
      this.currentPath = n.path
      this.content = n.content
      this.baseline = n.content
      this.contentRev++
      this.saveState = 'saved'
      // opening a note (esp. from search results) restores the file tree view
      this.searchQuery = ''
      this.searchHits = []
    },

    onEdited(content: string) {
      this.content = content
      if (content === this.baseline) {
        this.saveState = 'saved'
        return
      }
      this.saveState = 'dirty'
      this.scheduleSave()
    },

    scheduleSave() {
      window.clearTimeout(this.saveTimer)
      this.saveTimer = window.setTimeout(() => {
        void this.saveNow()
      }, AUTOSAVE_DELAY)
    },

    async saveNow() {
      window.clearTimeout(this.saveTimer)
      if (!this.currentPath || this.content === this.baseline) return
      const path = this.currentPath
      const payload = this.content
      this.saveState = 'saving'
      try {
        const res = await api<{ path: string; content: string }>('/api/note', {
          method: 'PUT',
          json: { path, content: payload },
        })
        // keep the newer local edits if the user kept typing during the request
        if (this.currentPath === path && this.content === payload) {
          this.baseline = res.content
          this.saveState = 'saved'
        } else {
          this.baseline = res.content
          if (this.dirty) this.scheduleSave()
        }
      } catch {
        this.saveState = 'error'
      }
    },

    async createNote(rel: string) {
      await api('/api/note', {
        method: 'POST',
        json: { path: rel, content: `# ${rel.split('/').pop()!.replace(/\.md$/i, '')}\n\n` },
      })
      await this.loadTree()
      await this.openNote(rel)
    },

    async renameNote(rel: string, newPath: string) {
      if (this.dirty && this.currentPath === rel) await this.saveNow()
      await api('/api/note/rename', { method: 'POST', json: { path: rel, newPath } })
      await this.loadTree()
      if (this.currentPath === rel) await this.openNote(newPath)
    },

    async deleteNote(rel: string) {
      await api(`/api/note?path=${encodeURIComponent(rel)}`, { method: 'DELETE' })
      await this.loadTree()
      if (this.currentPath === rel) {
        this.currentPath = null
        this.content = ''
        this.baseline = ''
        this.contentRev++
      }
    },

    async rebuildIndex() {
      await api('/api/index/rebuild', { method: 'POST' })
    },

    async search(q: string) {
      this.searchQuery = q
      if (!q.trim()) {
        this.searchHits = []
        return
      }
      this.searching = true
      try {
        const res = await api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`)
        // stale-response guard
        if (this.searchQuery === q) this.searchHits = res.hits
      } finally {
        this.searching = false
      }
    },

    onWsMessage(msg: WsMessage) {
      const p = msg.payload as { path?: string; content?: string } | undefined
      if (msg.type === 'note.updated' && p?.path) {
        if (p.path === this.currentPath && !this.dirty && typeof p.content === 'string' && p.content !== this.baseline) {
          // another tab edited the note we are viewing → refresh silently
          this.content = p.content
          this.baseline = p.content
          this.contentRev++
          this.saveState = 'saved'
        }
      } else if (msg.type === 'note.deleted' && p?.path) {
        void this.loadTree()
        if (p.path === this.currentPath) {
          this.currentPath = null
          this.content = ''
          this.baseline = ''
          this.contentRev++
        }
      } else if (msg.type === 'note.created') {
        void this.loadTree()
      }
    },
  },
})
