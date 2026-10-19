<script setup lang="ts">
import { computed } from 'vue'
import type { NoteEntry } from '../stores/app'
import TreeBranch, { type TreeNode } from './TreeBranch.vue'

const props = defineProps<{ files: NoteEntry[] }>()
const emit = defineEmits<{
  open: [path: string]
  contextmenuFile: [payload: { path: string; event: MouseEvent }]
}>()

function buildTree(files: NoteEntry[]): TreeNode[] {
  const root: TreeNode[] = []
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = f.path.split('/')
    let level = root
    let acc = ''
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part
      const isLeaf = i === parts.length - 1
      let node = level.find((n) => n.name === part && (isLeaf ? n.type === f.type : n.type === 'dir'))
      if (!node) {
        node = { name: part, path: acc, type: isLeaf ? f.type : 'dir', children: [] }
        level.push(node)
      }
      if (!isLeaf) level = node.children
    })
  }
  const sortLevel = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh-CN') : a.type === 'dir' ? -1 : 1))
    nodes.forEach((n) => sortLevel(n.children))
    return nodes
  }
  return sortLevel(root)
}

const tree = computed(() => buildTree(props.files))
</script>

<template>
  <div class="tree">
    <div v-if="files.length === 0" class="empty-hint">
      当前 vault 为空<br />右键或点击「＋ 新建笔记」开始
    </div>
    <TreeBranch
      v-for="node in tree"
      :key="node.path"
      :node="node"
      :depth="0"
      @open="(p) => emit('open', p)"
      @context="emit('contextmenuFile', $event)"
    />
  </div>
</template>
