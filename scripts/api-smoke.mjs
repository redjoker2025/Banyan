#!/usr/bin/env node
// Banyan M1 API smoke matrix — runs against a live server.
// Usage: node scripts/api-smoke.mjs <baseUrl> <token>
// Switches the server to a temp vault for isolation, then switches back.

import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

const BASE = process.argv[2] ?? 'http://127.0.0.1:3210'
const TOKEN = process.argv[3] ?? ''
if (!TOKEN) {
  console.error('usage: node scripts/api-smoke.mjs <baseUrl> <token>')
  process.exit(2)
}

const results = []
let vaultDir = null

function record(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, url, body) {
  const started = performance.now()
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, json, text, ms: Math.round(performance.now() - started) }
}

async function main() {
  // --- 0. switch to an isolated temp vault ---
  vaultDir = mkdtempSync(path.join(tmpdir(), 'banyan-smoke-'))
  const sw = await req('POST', '/api/vault', { path: vaultDir })
  record('vault.switch-to-temp', sw.status === 200, `status=${sw.status}`)

  // --- 1. auth ---
  const noAuth = await fetch(`${BASE}/api/tree`)
  record('auth.no-token-rejected', noAuth.status === 401, `status=${noAuth.status}`)
  const badAuth = await fetch(`${BASE}/api/tree`, { headers: { authorization: 'Bearer wrong' } })
  record('auth.bad-token-rejected', badAuth.status === 401, `status=${badAuth.status}`)
  const health = await req('GET', '/api/health')
  record('auth.valid-token-health', health.status === 200 && health.json?.ok === true, `status=${health.status}`)

  // --- 2. vault validation ---
  const badVault = await req('POST', '/api/vault', { path: 'Z:\\definitely\\not\\exists' })
  record('vault.nonexistent-folder-400', badVault.status === 400, `status=${badVault.status}`)
  const vaultGet = await req('GET', '/api/vault')
  record('vault.get-current', vaultGet.status === 200 && typeof vaultGet.json?.path === 'string', `path=${vaultGet.json?.path}`)

  // --- 3. tree ---
  const create1 = await req('POST', '/api/note', { path: 'sub/nested/中文笔记.md', content: '# 标题一\n\n本地优先的笔记软件，支持全文检索\n' })
  record('note.create-201', create1.status === 201, `status=${create1.status}`)
  await req('POST', '/api/note', { path: 'english.md', content: '# Hello\n\nsay hello world\n' })
  const tree = await req('GET', '/api/tree')
  const paths = (tree.json?.items ?? []).map((i) => i.path)
  record('tree.lists-and-hides-banyan', tree.status === 200 && paths.includes('sub') && paths.includes('sub/nested/中文笔记.md') && !paths.some((p) => p.includes('.banyan')), `count=${paths.length}`)

  // --- 4. note CRUD ---
  const dup = await req('POST', '/api/note', { path: 'english.md', content: 'dup' })
  record('note.create-duplicate-409', dup.status === 409, `status=${dup.status}`)
  const get1 = await req('GET', `/api/note?path=${encodeURIComponent('sub/nested/中文笔记.md')}`)
  record('note.get-content-roundtrip', get1.status === 200 && get1.json?.content?.includes('本地优先') && get1.json?.title === '标题一', `title=${get1.json?.title}`)
  const getMissing = await req('GET', `/api/note?path=ghost.md`)
  record('note.get-missing-404', getMissing.status === 404 && getMissing.json?.error === 'E_NOT_FOUND', `status=${getMissing.status}`)
  const put1 = await req('PUT', '/api/note', { path: 'english.md', content: '# Hello\n\nupdated body marker-x7\n' })
  record('note.put-save-200', put1.status === 200, `status=${put1.status} ${put1.ms}ms`)
  const putMissing = await req('PUT', '/api/note', { path: 'ghost.md', content: 'x' })
  record('note.put-missing-404', putMissing.status === 404, `status=${putMissing.status}`)

  // --- 5. journal (append-only) ---
  const journalFile = path.join(vaultDir, '.banyan', 'journal.jsonl')
  const journalOk = existsSync(journalFile) && readFileSync(journalFile, 'utf8').trim().split('\n').length >= 3
  record('journal.appended-lines', journalOk, journalOk ? 'created+updated entries present' : 'missing')

  // --- 6. rename ---
  const ren = await req('POST', '/api/note/rename', { path: 'english.md', newPath: 'renamed-doc.md' })
  record('note.rename-200', ren.status === 200 && ren.json?.path === 'renamed-doc.md', `status=${ren.status}`)
  const renConflict = await req('POST', '/api/note/rename', { path: 'renamed-doc.md', newPath: 'sub/nested/中文笔记.md' })
  record('note.rename-target-exists-409', renConflict.status === 409, `status=${renConflict.status}`)
  const renMissing = await req('POST', '/api/note/rename', { path: 'ghost.md', newPath: 'x.md' })
  record('note.rename-source-missing-404', renMissing.status === 404, `status=${renMissing.status}`)

  // search must find the renamed note's updated content (before it gets deleted)
  const s3 = await req('GET', `/api/search?q=${encodeURIComponent('marker-x7')}`)
  record('search.after-update-and-rename', s3.status === 200 && (s3.json?.hits ?? []).some((h) => h.path === 'renamed-doc.md'), `hits=${JSON.stringify(s3.json?.hits?.map((h) => h.path))}`)

  // --- 7. delete ---
  const del = await req('DELETE', `/api/note?path=${encodeURIComponent('renamed-doc.md')}`)
  record('note.delete-200', del.status === 200, `status=${del.status}`)
  const delAgain = await req('DELETE', `/api/note?path=renamed-doc.md`)
  record('note.delete-missing-404', delAgain.status === 404, `status=${delAgain.status}`)

  // --- 8. search ---
  const s1 = await req('GET', `/api/search?q=${encodeURIComponent('全文检索')}`)
  record('search.cjk-substring-trigram', s1.status === 200 && (s1.json?.hits ?? []).some((h) => h.path.includes('中文笔记') && h.snippet), `hits=${s1.json?.hits?.length}`)
  const s2 = await req('GET', `/api/search?q=${encodeURIComponent('检索')}`)
  record('search.short-query-like-fallback', s2.status === 200 && (s2.json?.hits ?? []).length >= 1, `hits=${s2.json?.hits?.length}`)
  const s4 = await req('GET', `/api/search?q=${encodeURIComponent('不存在的词组xx')}`)
  record('search.no-hit-empty', s4.status === 200 && s4.json?.hits?.length === 0, `hits=${s4.json?.hits?.length}`)
  const s5 = await req('GET', `/api/search?q=${encodeURIComponent('"but" AND (drop)')}`)
  record('search.malformed-query-no-500', s5.status === 200, `status=${s5.status}`)

  // --- 9. path whitelist ---
  const esc1 = await req('GET', `/api/note?path=${encodeURIComponent('../escape.md')}`)
  record('whitelist.dotdot-rejected', esc1.status === 400 && esc1.json?.error === 'E_PATH_OUTSIDE_VAULT', `status=${esc1.status}`)
  const esc2 = await req('GET', `/api/note?path=${encodeURIComponent('.banyan/config.json')}`)
  record('whitelist.banyan-dir-rejected', esc2.status === 400 && esc2.json?.error === 'E_PATH_OUTSIDE_VAULT', `status=${esc2.status}`)
  const esc3 = await req('DELETE', `/api/note?path=${encodeURIComponent('a/../../boot.md')}`)
  record('whitelist.traversal-delete-rejected', esc3.status === 400, `status=${esc3.status}`)

  // --- 10. index rebuild ---
  const rb = await req('POST', '/api/index/rebuild')
  const rbCheck = await req('GET', `/api/search?q=${encodeURIComponent('全文检索')}`)
  record('index.rebuild-keeps-hits', rb.status === 200 && (rbCheck.json?.hits ?? []).length >= 1, `hits=${rbCheck.json?.hits?.length}`)

  // --- 11. large note roundtrip ---
  const bigBody = `# big\n\n${'榕树测试内容。'.repeat(60_000)}` // ~1.1 MB
  const bigPut = await req('PUT', '/api/note', { path: 'sub/nested/中文笔记.md', content: bigBody })
  const bigGet = await req('GET', `/api/note?path=${encodeURIComponent('sub/nested/中文笔记.md')}`)
  record('note.large-roundtrip-1MB', bigPut.status === 200 && bigGet.json?.content?.length === bigBody.length, `put=${bigPut.ms}ms get=${bigGet.ms}ms size=${bigGet.json?.content?.length}`)
  const bigSearch = await req('GET', `/api/search?q=${encodeURIComponent('榕树测试内容')}`)
  record('search.large-body', bigSearch.status === 200 && bigSearch.json?.hits?.length >= 1, `hits=${bigSearch.json?.hits?.length} ${bigSearch.ms}ms`)

  // --- 12. static client ---
  const indexHtml = await fetch(`${BASE}/`)
  const html = await indexHtml.text()
  record('static.spa-index', indexHtml.status === 200 && html.includes('<div id="app">'), `status=${indexHtml.status}`)
  const missingAsset = await fetch(`${BASE}/assets/nope.js`)
  record('static.missing-asset-404', missingAsset.status === 404, `status=${missingAsset.status}`)
  const traversal = await fetch(`${BASE}/..%2f..%2fpackage.json`)
  record('static.traversal-blocked', traversal.status === 403 || traversal.status === 404, `status=${traversal.status}`)

  // --- restore original vault ---
  const back = await req('POST', '/api/vault', { path: 'D:\\banyan-demo' })
  record('vault.switch-back', back.status === 200, `status=${back.status}`)
  rmSync(vaultDir, { recursive: true, force: true })

  const passed = results.filter((r) => r.pass).length
  const failed = results.length - passed
  console.log(`\n=== ${passed}/${results.length} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('matrix crashed:', e)
  process.exit(1)
})
