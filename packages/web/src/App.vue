<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useAppStore, type SearchHit } from './stores/app'
import { api } from './api'
import { installPluginHost, activateEnabledClientPlugins } from './pluginHost'
import FileTree from './components/FileTree.vue'
import EditorPane from './components/EditorPane.vue'
import StatusBar from './components/StatusBar.vue'
import VaultPicker from './components/VaultPicker.vue'
import ContextMenu, { type MenuItem } from './components/ContextMenu.vue'
import PluginSlot from './components/PluginSlot.vue'
import PluginsDrawer from './components/PluginsDrawer.vue'

const store = useAppStore()
const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)

onMounted(() => {
  installPluginHost()
  void store.boot()
  void activateEnabledClientPlugins()
})

// opening a vault (at startup or via the picker) activates its client plugins
watch(
  () => store.vaultPath,
  (v) => {
    if (v) void activateEnabledClientPlugins()
  },
)

/** host context handed to client plugin extensions (live getters) */
const pluginApi = {
  get currentPath() {
    return store.currentPath
  },
  get content() {
    return store.content
  },
  get charCount() {
    return store.content.length
  },
  get pluginState() {
    return store.pluginState
  },
  openNote: (path: string) => store.openNote(path),
  apiFetch: <T,>(path: string, init?: Parameters<typeof api<T>>[1]) => api<T>(path, init),
  onNoteChange: (cb: () => void) => store.addNoteListener(cb),
}

async function runCommand(cmd: { run: (api: unknown) => void | Promise<void> }) {
  try {
    await cmd.run(pluginApi)
  } catch (e) {
    window.alert(`命令执行失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function highlight(hit: SearchHit): string {
  // server snippets use [ ] markers; escape HTML first, then convert
  return esc(hit.snippet ?? '').replaceAll('[', '<mark>').replaceAll(']', '</mark>')
}

function newNote(targetDir?: string) {
  const dir = targetDir ? `${targetDir}/` : ''
  const name = window.prompt('新建笔记（文件名，自动补 .md）', `${dir}未命名笔记.md`)
  if (!name) return
  const rel = name.endsWith('.md') ? name : `${name}.md`
  void store
    .createNote(rel.replaceAll('\\', '/').replace(/^\/+/, ''))
    .catch((e) => window.alert(`新建失败：${e.message}`))
}

function renameNote(path: string) {
  const newPath = window.prompt('重命名（可含相对路径）', path)
  if (!newPath || newPath === path) return
  void store
    .renameNote(path, newPath.replaceAll('\\', '/'))
    .catch((e) => window.alert(`重命名失败：${e.message}`))
}

function deleteNote(path: string) {
  if (!window.confirm(`确定删除「${path}」？此操作会从磁盘删除文件。`)) return
  void store.deleteNote(path).catch((e) => window.alert(`删除失败：${e.message}`))
}

async function rebuildIndex() {
  await store.rebuildIndex()
  window.alert('索引已全量重建')
}

function switchVault() {
  if (store.dirty && !window.confirm('有未保存的修改，切换 vault 前会先自动保存。继续？')) return
  void store.saveNow().then(() => {
    store.vaultPath = null
  })
}

function openContextMenu(event: MouseEvent, target?: string) {
  event.preventDefault()
  const items: MenuItem[] = target
    ? [
        { label: '打开', action: () => void store.openNote(target) },
        { label: '重命名…', action: () => renameNote(target) },
        { label: '删除…', danger: true, action: () => deleteNote(target) },
      ]
    : [
        { label: '新建笔记…', action: () => newNote() },
        { label: '重建全文索引', action: () => void rebuildIndex() },
      ]
  menu.value = { x: event.clientX, y: event.clientY, items }
}

function onFileContext(payload: { path: string; event: MouseEvent }) {
  openContextMenu(payload.event, payload.path)
}
</script>

<template>
  <div class="layout" @click="menu = null">
    <header class="header">
      <span class="logo">榕<span class="en">Banyan</span></span>
      <button @click="newNote()">＋ 新建笔记</button>
      <button @click="rebuildIndex()">重建索引</button>
      <details v-if="store.pluginCommands.length" class="command-menu">
        <summary>命令</summary>
        <div class="command-list">
          <a v-for="cmd in store.pluginCommands" :key="cmd.key" class="command-item" @click="runCommand(cmd)">
            {{ cmd.title }}
          </a>
        </div>
      </details>
      <div class="spacer"></div>
      <button @click="store.pluginsOpen = true">插件</button>
      <button v-if="store.vaultPath" @click="switchVault()">切换 Vault</button>
    </header>

    <aside class="sidebar" @contextmenu="openContextMenu($event)">
      <div class="search">
        <input
          type="text"
          placeholder="🔍 全文搜索（标题 + 正文）"
          :value="store.searchQuery"
          @input="store.search(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div v-if="store.searchQuery.trim()" class="search-results">
        <div v-if="store.searchHits.length === 0 && !store.searching" class="empty-hint">无匹配结果</div>
        <div v-for="hit in store.searchHits" :key="hit.path" class="search-hit" @click="store.openNote(hit.path)">
          <div class="hit-title">{{ hit.title }}</div>
          <div class="hit-path">{{ hit.path }}</div>
          <div v-if="hit.snippet" class="hit-snippet" v-html="highlight(hit)"></div>
        </div>
      </div>
      <FileTree v-else :files="store.files" @open="(p) => store.openNote(p)" @contextmenu-file="onFileContext" />
    </aside>

    <main class="editor-pane">
      <EditorPane v-if="store.currentPath" />
      <div v-else class="editor-empty">
        <div class="mark">榕</div>
        <div class="title">根植本地，枝达万物</div>
        <div class="hint">在左侧选择一条笔记，或新建一条开始书写</div>
        <div class="keys">
          <span><kbd>Ctrl</kbd>搜索全文</span>
          <span><kbd>插件</kbd>扩展面板与命令</span>
        </div>
      </div>
    </main>

    <aside class="right-panel">
      <PluginSlot v-for="panel in store.rightPanels" :key="panel.key" :item="panel" :api="pluginApi" />
      <div v-if="store.rightPanels.length === 0" class="panel-placeholder">
        <strong>面板区</strong><br />
        该区域预留给客户端插件的 <code>panel.right</code> 扩展点。点击顶栏「插件」启用
        反向链接 / 标签聚合等插件。
      </div>
    </aside>

    <StatusBar />

    <VaultPicker v-if="store.vaultPath === null && !store.needsToken" />
    <PluginsDrawer v-if="store.pluginsOpen" @close="store.pluginsOpen = false" />
    <ContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menu.items" @close="menu = null" />
  </div>
</template>
