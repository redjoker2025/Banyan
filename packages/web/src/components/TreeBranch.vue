<script setup lang="ts">
import { ref } from 'vue'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children: TreeNode[]
}

const props = defineProps<{ node: TreeNode; depth: number }>()
const emit = defineEmits<{
  open: [path: string]
  context: [payload: { path: string; event: MouseEvent }]
}>()

const expanded = ref(true)

function onClick() {
  if (props.node.type === 'file') emit('open', props.node.path)
  else expanded.value = !expanded.value
}

function onContext(event: MouseEvent) {
  if (props.node.type !== 'file') return
  event.preventDefault()
  event.stopPropagation()
  emit('context', { path: props.node.path, event })
}
</script>

<template>
  <div>
    <div class="tree-item" :style="{ paddingLeft: 8 + depth * 14 + 'px' }" @click="onClick" @contextmenu="onContext">
      <span class="icon">{{ node.type === 'dir' ? (expanded ? '📂' : '📁') : '📄' }}</span>
      <span>{{ node.name }}</span>
    </div>
    <template v-if="node.type === 'dir' && expanded">
      <TreeBranch
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @open="(p) => emit('open', p)"
        @context="emit('context', $event)"
      />
    </template>
  </div>
</template>
