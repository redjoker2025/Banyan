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

/** plugin statusbar items, re-evaluated when note state or plugin data changes */
const pluginStatusTexts = computed(() =>
  store.statusbarItems
    .map((item) => ({
      key: item.key,
      text: (() => {
        try {
          return item.render({
            get currentPath() {
              return store.currentPath
            },
            get content() {
              return store.content
            },
            get charCount() {
              return store.content.length
            },
            get pluginState() {
              return store.pluginState
            },
          })
        } catch {
          return ''
        }
      })(),
    }))
    .filter((t) => t.text),
)
</script>

<template>
  <footer class="statusbar">
    <span><span class="dot" :class="{ on: store.connected }"></span>{{ store.connected ? '已连接' : '连接中断，重连中…' }}</span>
    <span class="save-state" :class="store.saveState">{{ saveText }}</span>
    <span v-for="item in pluginStatusTexts" :key="item.key" class="plugin-status">{{ item.text }}</span>
    <span class="spacer"></span>
    <span v-if="store.currentPath">{{ store.currentPath }}</span>
    <span>{{ charCount }} 字符</span>
  </footer>
</template>

