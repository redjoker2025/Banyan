/**
 * tags client entry — panel.right aggregating the frontmatter `tags` field
 * across all notes; clicking a tag filters and lists the matching notes.
 */
export function activate(host) {
  host.registerPanel({
    side: 'right',
    title: '标签',
    render(el, api) {
      let disposed = false
      let selected = null
      const refresh = async () => {
        if (disposed) return
        try {
          const res = await api.apiFetch('/api/tags')
          if (disposed) return
          const notes = res.notes ?? []
          const counts = new Map()
          for (const n of notes) {
            for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
          }
          el.innerHTML = ''
          const tagList = document.createElement('div')
          tagList.className = 'plugin-list'
          if (counts.size === 0) {
            tagList.innerHTML = '<div class="plugin-empty">暂无标签<br /><span>在笔记 frontmatter 中添加 tags 字段</span></div>'
          }
          for (const [tag, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
            const item = document.createElement('a')
            item.className = 'plugin-item' + (selected === tag ? ' active' : '')
            item.textContent = `#${tag}（${count}）`
            item.onclick = () => {
              selected = selected === tag ? null : tag
              refresh()
            }
            tagList.appendChild(item)
          }
          el.appendChild(tagList)

          if (selected) {
            const list = document.createElement('div')
            list.className = 'plugin-list'
            const head = document.createElement('div')
            head.className = 'plugin-heading'
            head.textContent = `包含 #${selected} 的笔记`
            list.appendChild(head)
            for (const n of notes.filter((n) => n.tags.includes(selected))) {
              const item = document.createElement('a')
              item.className = 'plugin-item'
              item.textContent = n.path
              item.onclick = () => api.openNote(n.path)
              list.appendChild(item)
            }
            el.appendChild(list)
          }
        } catch (e) {
          el.innerHTML = `<div class="plugin-empty">加载失败：${e.message}</div>`
        }
      }
      refresh()
      return api.onNoteChange(refresh)
    },
  })
}
