/**
 * docx client entry — commands for importing a .docx file and exporting the
 * current note as .docx. Export download uses the authenticated API URL.
 */
export function activate(host) {
  host.registerCommand({
    id: 'banyan.docx.import',
    title: '导入 Word 文档 (.docx → 笔记)',
    run(api) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.docx'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const target = window.prompt('导入为笔记（路径，自动补 .md）', file.name.replace(/\.docx$/i, '') + '.md')
        if (!target) return
        const form = new FormData()
        form.append('file', file)
        form.append('path', target.endsWith('.md') ? target : `${target}.md`)
        try {
          const res = await api.apiFetch('/api/plugins/banyan.docx/import', { method: 'POST', body: form })
          window.alert(`导入成功：${res.path}（${res.chars} 字符）`)
          await api.openNote(res.path)
        } catch (e) {
          window.alert(`导入失败：${e.message}`)
        }
      }
      input.click()
    },
  })

  host.registerCommand({
    id: 'banyan.docx.export',
    title: '导出当前笔记为 Word (.docx)',
    run(api) {
      if (!api.currentPath) {
        window.alert('请先打开一条笔记')
        return
      }
      const token = api.getToken()
      window.open(`/api/plugins/banyan.docx/export?path=${encodeURIComponent(api.currentPath)}&token=${encodeURIComponent(token)}`)
    },
  })
}
