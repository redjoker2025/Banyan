<script lang="ts">
export interface MenuItem {
  label: string
  action: () => void
  danger?: boolean
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ close: [] }>()
const el = ref<HTMLDivElement | null>(null)

const left = computed(() => Math.min(props.x, window.innerWidth - 180))
const top = computed(() => Math.max(4, Math.min(props.y, window.innerHeight - props.items.length * 34 - 12)))

function run(item: MenuItem) {
  emit('close')
  item.action()
}

function onOutside(e: MouseEvent) {
  if (el.value && !el.value.contains(e.target as Node)) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('click', onOutside, { capture: true })
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onOutside, { capture: true })
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="el" class="context-menu" :style="{ left: `${left}px`, top: `${top}px` }" @contextmenu.prevent>
    <div v-for="item in props.items" :key="item.label" class="menu-item" :class="{ danger: item.danger }" @click="run(item)">
      {{ item.label }}
    </div>
  </div>
</template>
