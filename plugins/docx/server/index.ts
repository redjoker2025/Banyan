/**
 * docx server entry — Word (.docx) import & export.
 *
 * Read:  mammoth (BSD-2-Clause) converts .docx → Markdown.
 * Write: docx (MIT) generates .docx from a lightweight Markdown subset
 *        (headings, bold/italic/inline code, links, lists, quotes,
 *        fenced code blocks, paragraphs).
 *
 * Routes are namespaced by the host under /api/plugins/banyan.docx/.
 */
import mammoth from 'mammoth'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, BorderStyle } from 'docx'

export default {
  inject: ['http', 'vault', 'logger'],

  apply(ctx: any) {
    ctx.http.registerRoute('POST', '/import', async (req: Request) => {
      const form = await req.formData().catch(() => null)
      if (!form) {
        return json(400, { error: 'E_BAD_REQUEST', message: 'expect multipart/form-data with a "file" field (.docx)' })
      }
      const file = form.get('file')
      if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.docx')) {
        return json(400, { error: 'E_BAD_REQUEST', message: 'field "file" must be a .docx file' })
      }
      const requested = String(form.get('path') ?? '').trim()
      const target = requested || toNoteName(file.name)
      if (!target.toLowerCase().endsWith('.md')) {
        return json(400, { error: 'E_BAD_REQUEST', message: 'target path must end with .md' })
      }
      if (await ctx.vault.exists(target)) {
        return json(409, { error: 'E_CONFLICT', message: `note already exists: ${target}` })
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      let markdown: string
      try {
        const result = await mammoth.convertToMarkdown({ buffer })
        markdown = `# ${stripExt(target)}\n\n${(result.value ?? '').trim()}\n`
      } catch (e) {
        return json(400, { error: 'E_BAD_REQUEST', message: `failed to parse docx: ${e instanceof Error ? e.message : String(e)}` })
      }
      // write through the gated vault capability (declared fs.globs = **)
      await ctx.vault.write(target, markdown)
      ctx.logger.info(`[docx] imported ${file.name} → ${target} (${markdown.length} chars)`)
      return json(200, { path: target, chars: markdown.length })
    })

    ctx.http.registerRoute('GET', '/export', async (req: Request) => {
      const path = new URL(req.url).searchParams.get('path') ?? ''
      if (!path) {
        return json(400, { error: 'E_BAD_REQUEST', message: 'missing ?path=' })
      }
      const markdown = await ctx.vault.read(path)
      const doc = new Document({ sections: [{ children: markdownToDocx(markdown) }] })
      const buffer = await Packer.toBuffer(doc)
      const filename = path.split('/').pop()!.replace(/\.md$/i, '.docx')
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        },
      })
    })
  },
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function toNoteName(docxName: string): string {
  return `${docxName.replace(/\.docx$/i, '').replace(/[\\/:*?"<>|]/g, '_')}.md`
}

function stripExt(notePath: string): string {
  return (notePath.split('/').pop() ?? notePath).replace(/\.md$/i, '')
}

/** Minimal Markdown → docx blocks converter (headings, lists, quotes, code, inline styles). */
export function markdownToDocx(markdown: string): (Paragraph | ExternalHyperlink)[] {
  const out: Paragraph[] = []
  const lines = markdown.split(/\r?\n/)
  let inCode = false
  const codeLines: string[] = []

  const flushCode = () => {
    if (codeLines.length) {
      out.push(new Paragraph({
        children: [new TextRun({ text: codeLines.join('\n'), font: 'Consolas', size: 20 })],
        shading: { fill: 'F2F1EC' },
        spacing: { before: 120, after: 120 },
      }))
      codeLines.length = 0
    }
  }

  for (const raw of lines) {
    if (raw.trimStart().startsWith('```')) {
      if (inCode) flushCode()
      else codeLines.length = 0
      inCode = !inCode
      continue
    }
    if (inCode) {
      codeLines.push(raw)
      continue
    }
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]
      out.push(new Paragraph({ heading: levels[heading[1]!.length - 1], children: runs(heading[2]!) }))
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      out.push(new Paragraph({
        children: runs(quote[1]!),
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '2E6B4F' } },
      }))
      continue
    }
    const ul = /^[-*]\s+(.*)$/.exec(line)
    if (ul) {
      out.push(new Paragraph({ children: runs(ul[1]!), bullet: { level: 0 } }))
      continue
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line)
    if (ol) {
      out.push(new Paragraph({ children: runs(ol[1]!), numbering: { reference: 'banyan-ordered', level: 0 } }))
      continue
    }
    out.push(new Paragraph({ children: runs(line), alignment: AlignmentType.LEFT }))
  }
  flushCode()
  return out
}

/** Inline styles: **bold**, *italic*, `code`, [text](url) */
function runs(text: string): (TextRun | ExternalHyperlink)[] {
  const parts: (TextRun | ExternalHyperlink)[] = []
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) parts.push(new TextRun(text.slice(last, m.index)))
    if (m[2] !== undefined) parts.push(new TextRun({ text: m[2], bold: true }))
    else if (m[4] !== undefined) parts.push(new TextRun({ text: m[4], italics: true }))
    else if (m[6] !== undefined) parts.push(new TextRun({ text: m[6], font: 'Consolas', shading: { fill: 'F2F1EC' } }))
    else if (m[8] !== undefined) parts.push(new ExternalHyperlink({
      link: m[9]!,
      children: [new TextRun({ text: m[8], style: 'Hyperlink' })],
    }))
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push(new TextRun(text.slice(last)))
  return parts
}
