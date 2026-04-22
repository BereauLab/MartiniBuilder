<template>
  <div class="absolute-center bg-white q-pa-md rounded-borders shadow-2" style="z-index: 100; text-align: center;">
    <div class="text-h6 q-mb-md">Load an SDF File</div>
    <q-file v-model="sdfFile" label="Select .sdf file" outlined @update:model-value="onFileSelected" accept=".sdf" />
  </div>
</template>

<script setup>
import { ref } from 'vue'

const emit = defineEmits(['loadSdf'])
const sdfFile = ref(null)

function onFileSelected(file) {
  if (!file) return
  const reader = new FileReader()
  reader.onload = (e) => {
    emit('loadSdf', e.target.result)
  }
  reader.readAsText(file)
}
</script>
