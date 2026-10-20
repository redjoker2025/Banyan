<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  item: { key: string; title: string; render: (el: HTMLElement, api: unknown) => void | (() => void) }
  api: unknown
}>()

const host = ref<HTMLElement | null>(null)
let cleanup: (() => void) | null = null

onMounted(() => {
  if (!host.value) return
  const result = props.item.render(host.value, props.api)
  if (typeof result === 'function') cleanup = result
})

onBeforeUnmount(() => {
  cleanup?.()
  cleanup = null
})
</script>

<template>
  <section class="plugin-panel">
    <h4 class="plugin-panel-title">{{ item.title }}</h4>
    <div ref="host" class="plugin-panel-body"></div>
  </section>
</template>
