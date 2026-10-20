<script setup lang="ts">
import { ref } from 'vue'
import { useAppStore, type PluginStatus } from '../stores/app'

const store = useAppStore()
const emit = defineEmits<{ close: [] }>()
const busyId = ref<string | null>(null)
const lastError = ref('')

async function toggle(p: PluginStatus) {
  busyId.value = p.id
  lastError.value = ''
  try {
    if (p.enabled) await store.disablePlugin(p.id)
    else await store.enablePlugin(p.id)
  } catch (e) {
    const err = e as { message?: string; parties?: string[] }
    lastError.value = `${p.name}：${err.message ?? String(e)}${err.parties?.length ? `（冲突双方：${err.parties.join(' ↔ ')}）` : ''}`
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="dialog plugin-drawer">
      <h3>插件</h3>
      <p>
        启用/禁用即时生效；服务端插件经权限代理运行，越权调用写入
        <code>.banyan/audit.jsonl</code>；禁用即卸载，UI 扩展点全部撤销。
      </p>
      <div class="plugin-rows">
        <div v-for="p in store.plugins" :key="p.id" class="plugin-row" :class="{ error: p.error }">
          <div class="plugin-row-main">
            <div class="plugin-row-title">
              <strong>{{ p.name }}</strong>
              <span class="plugin-row-meta">v{{ p.version }} · {{ p.source === 'official' ? '官方' : '已安装' }} · {{ p.id }}</span>
            </div>
            <div class="plugin-row-desc">{{ p.description }}</div>
            <div v-if="p.error" class="plugin-row-error">⚠ {{ p.error }}</div>
          </div>
          <button
            :class="p.enabled ? '' : 'primary'"
            :disabled="busyId === p.id || Boolean(p.error)"
            @click="toggle(p)"
          >
            {{ busyId === p.id ? '处理中…' : p.enabled ? '禁用' : '启用' }}
          </button>
        </div>
      </div>
      <p v-if="lastError" class="plugin-drawer-error">{{ lastError }}</p>
      <div class="row">
        <button @click="emit('close')">关闭</button>
      </div>
    </div>
  </div>
</template>
