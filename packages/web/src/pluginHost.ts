import { api, getToken } from './api'
import { useAppStore } from './stores/app'

/**
 * Client plugin host (M2 §4.4): dynamically imports enabled client entries
 * and exposes registration points for panel / statusbar / command /
 * editor.extension. Disabling a plugin runs its disposables in reverse —
 * every UI extension point is revoked (unload leaves no residue).
 */

interface PanelOptions {
  side?: 'left' | 'right'
  title: string
  render: (el: HTMLElement, api: unknown) => void | (() => void)
}

interface CommandOptions {
  id: string
  title: string
  run: (api: unknown) => void | Promise<void>
}

type EditorExtensionFactory = (cm: Record<string, unknown>) => unknown

export interface HostApi {
  registerPanel(options: PanelOptions): () => void
  registerStatusbar(render: (api: unknown) => string): () => void
  registerCommand(options: CommandOptions): () => void
  registerEditorExtension(factory: EditorExtensionFactory): () => void
}

const disposables = new Map<string, Array<() => void>>()
const activated = new Set<string>()

export function installPluginHost(): void {
  const store = useAppStore()
  store.pluginStateHandler = (id, enabled) => {
    if (enabled) void activateClient(id).catch((e) => console.error(`[plugins] activate ${id} failed`, e))
    else deactivateClient(id)
  }
}

export async function activateEnabledClientPlugins(): Promise<void> {
  const store = useAppStore()
  await store.loadPlugins()
  for (const plugin of store.plugins.filter((p) => p.enabled && p.hasClient && !p.error)) {
    await activateClient(plugin.id).catch((e) => console.error(`[plugins] activate ${plugin.id} failed`, e))
  }
}

async function activateClient(id: string): Promise<void> {
  if (activated.has(id)) return
  const store = useAppStore()
  const url = `/plugins/${encodeURIComponent(id)}/client?token=${encodeURIComponent(getToken())}`
  const mod = (await import(/* @vite-ignore */ url)) as { activate?: (host: HostApi) => void; default?: { activate?: (host: HostApi) => void } }
  const activate = mod.activate ?? mod.default?.activate
  if (typeof activate !== 'function') {
    console.error(`[plugins] client entry of "${id}" has no activate()`)
    return
  }
  const list: Array<() => void> = []
  disposables.set(id, list)
  const track = <T>(dispose: () => void, value: T): T => {
    list.push(dispose)
    return value
  }
  const hostApi: HostApi = {
    registerPanel(options) {
      const key = `${id}#panel${store.pluginPanelSeq++}`
      store.pluginPanels.push({ key, pluginId: id, side: options.side ?? 'right', title: options.title, render: options.render })
      return track(() => {
        store.pluginPanels = store.pluginPanels.filter((p) => p.key !== key)
      }, key)
    },
    registerStatusbar(render) {
      const key = `${id}#status${store.pluginPanelSeq++}`
      store.statusbarItems.push({ key, pluginId: id, render })
      return track(() => {
        store.statusbarItems = store.statusbarItems.filter((s) => s.key !== key)
      }, key)
    },
    registerCommand(options) {
      const key = `${id}#cmd:${options.id}`
      store.pluginCommands.push({ key, pluginId: id, id: options.id, title: options.title, run: options.run })
      return track(() => {
        store.pluginCommands = store.pluginCommands.filter((c) => c.key !== key)
      }, key)
    },
    registerEditorExtension(factory) {
      const key = `${id}#ext${store.pluginPanelSeq++}`
      store.editorExtensions.push({ key, pluginId: id, factory })
      store.editorExtensionRev++
      return track(() => {
        store.editorExtensions = store.editorExtensions.filter((x) => x.key !== key)
        store.editorExtensionRev++
      }, key)
    },
  }
  activate(hostApi)
  activated.add(id)
}

function deactivateClient(id: string): void {
  if (!activated.has(id)) return
  const list = disposables.get(id) ?? []
  for (const dispose of list.reverse()) {
    try {
      dispose()
    } catch (e) {
      console.error(`[plugins] dispose of "${id}" failed`, e)
    }
  }
  disposables.delete(id)
  activated.delete(id)
}
