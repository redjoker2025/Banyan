<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()

const saveText = computed(() => {
  switch (store.saveState) {
    case 'saved':
      return '已保存'
    case 'dirty':
      return '有未保存的更改'
    case 'saving':
      return '保存中…'
    case 'error':
      return '保存失败'
  }
})

const charCount = computed(() => store.content.length)
</script>

<template>
  <footer class="statusbar">
    <span><span class="dot" :class="{ on: store.connected }"></span>{{ store.connected ? '已连接' : '连接中断，重连中…' }}</span>
    <span class="save-state" :class="store.saveState">{{ saveText }}</span>
    <span class="spacer"></span>
    <span v-if="store.currentPath">{{ store.currentPath }}</span>
    <span>{{ charCount }} 字符</span>
  </footer>
</template>
