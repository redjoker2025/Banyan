/**
 * word-count client entry — statusbar item showing the word count of the
 * current note, published by the server half via `plugin.state`.
 */
export function activate(host) {
  host.registerStatusbar((api) => {
    if (!api.currentPath) return ''
    const counts = api.pluginState['banyan.word-count'] ?? {}
    const count = counts[api.currentPath]
    if (count === undefined) return ''
    return `${count} 词`
  })
}
