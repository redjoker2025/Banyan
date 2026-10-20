/**
 * daily-note client entry — registers the command「打开/创建今日笔记」
 * which opens (creating if needed) the `YYYY-MM-DD.md` note for today.
 */
export function activate(host) {
  host.registerCommand({
    id: 'banyan.daily-note.open',
    title: '打开/创建今日笔记',
    async run(api) {
      const d = new Date()
      const name = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`
      try {
        await api.apiFetch('/api/note', {
          method: 'POST',
          json: { path: name, content: `# ${name.replace(/\.md$/, '')}\n\n` },
        })
      } catch (e) {
        if (e.code !== 'E_CONFLICT') throw e // already exists → just open it
      }
      await api.openNote(name)
    },
  })
}
