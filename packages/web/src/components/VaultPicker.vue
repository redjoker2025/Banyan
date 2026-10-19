<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
const folder = ref('')
const busy = ref(false)
const error = ref('')

async function open() {
  if (!folder.value.trim()) return
  busy.value = true
  error.value = ''
  try {
    await store.openVault(folder.value.trim())
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="overlay">
    <div class="dialog">
      <h3>选择 Vault 文件夹</h3>
      <p>
        Banyan 以本地文件夹作为笔记库（唯一事实来源）。输入服务器所在机器上的一个文件夹绝对路径，
        例如 <code>D:\notes</code>。首次打开会自动创建 <code>.banyan/</code> 元数据目录并建立全文索引。
      </p>
      <input
        v-model="folder"
        type="text"
        placeholder="例如 D:\notes"
        @keydown.enter="open"
      />
      <p v-if="error" style="color: var(--danger); margin-top: 8px">{{ error }}</p>
      <div class="row">
        <button class="primary" :disabled="busy || !folder.trim()" @click="open">
          {{ busy ? '打开中…' : '打开' }}
        </button>
      </div>
    </div>
  </div>
</template>
