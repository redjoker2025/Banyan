/**
 * backlinks client entry — panel.right listing notes that link to the
 * current note (Markdown links and [[wiki links]] resolved server-side).
 */
export function activate(host) {
  host.registerPanel({
    side: 'right',
    title: '反向链接',
    render(el, api) {
      let disposed = false
      const refresh = async () => {
        if (disposed) return
        if (!api.currentPath) {
          el.innerHTML = '<div class="plugin-empty">未打开笔记</div>'
          return
        }
        try {
          const res = await api.apiFetch(`/api/graph/backlinks?path=${encodeURIComponent(api.currentPath)}`)
          if (disposed) return
          const paths = res.paths ?? []
          el.innerHTML = ''
          if (!paths.length) {
            el.innerHTML = '<div class="plugin-empty">暂无反向链接<br /><span>用 [[笔记名]] 或 Markdown 链接引用本笔记</span></div>'
            return
          }
          const list = document.createElement('div')
          list.className = 'plugin-list'
          for (const p of paths) {
            const item = document.createElement('a')
            item.className = 'plugin-item'
            item.textContent = p
            item.onclick = () => api.openNote(p)
            list.appendChild(item)
          }
          el.appendChild(list)
        } catch (e) {
          el.innerHTML = `<div class="plugin-empty">加载失败：${e.message}</div>`
        }
      }
      refresh()
      return api.onNoteChange(refresh)
    },
  })
}
