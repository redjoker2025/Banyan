<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const host = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
let applying = false

function createView(): EditorView {
  return new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: store.content,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !applying) {
            store.onEdited(update.state.doc.toString())
          }
        }),
      ],
    }),
  })
}

function replaceDoc(content: string) {
  if (!view) return
  applying = true
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
  applying = false
}

onMounted(() => {
  view = createView()
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// note switch (open / create / rename) → load full content
watch(
  () => store.currentPath,
  (path) => {
    if (path) replaceDoc(store.content)
  },
)

// remote update from another tab → refresh silently
watch(
  () => store.contentRev,
  () => {
    if (store.currentPath) replaceDoc(store.content)
  },
)
</script>

<template>
  <div class="editor-host" ref="host"></div>
</template>

<style scoped>
.editor-host {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.editor-host :deep(.cm-editor) {
  flex: 1;
}
</style>
