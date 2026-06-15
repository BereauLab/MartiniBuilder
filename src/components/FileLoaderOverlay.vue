<template>
  <div class="absolute-center bg-white q-pa-md rounded-borders shadow-2" style="z-index: 100; width: 360px;">
    <div class="text-h6 q-mb-md text-center">Load a Mapping</div>

    <q-file v-model="sdfFile" label="Select .sdf file (required)" outlined dense accept=".sdf" class="q-mb-sm">
      <template v-slot:prepend><q-icon name="upload_file" /></template>
    </q-file>

    <q-file v-model="ndxFile" label="Select mapping.ndx (optional)" outlined dense accept=".ndx" clearable
            class="q-mb-sm">
      <template v-slot:prepend><q-icon name="upload_file" /></template>
    </q-file>

    <q-file v-model="itpFile" label="Select mapping.itp (optional)" outlined dense accept=".itp" clearable
            :disable="!ndxFile" class="q-mb-md">
      <template v-slot:prepend><q-icon name="upload_file" /></template>
    </q-file>

    <div class="text-caption text-grey-6 q-mb-md">
      Loading only an .sdf lets you build the mapping from scratch. Adding a mapping.ndx restores the
      atom-to-bead assignment; adding a mapping.itp additionally restores bead types, bonds, angles,
      dihedrals and virtual sites.
    </div>

    <q-btn color="primary" label="Load" class="full-width" :disable="!sdfFile" @click="loadSelected" />
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'

const emit = defineEmits(['loadFiles'])
const sdfFile = ref(null)
const ndxFile = ref(null)
const itpFile = ref(null)

// An itp without an ndx cannot be applied (no beads to attach it to).
watch(ndxFile, val => { if (!val) itpFile.value = null })

function readText(file) {
  if (!file) return Promise.resolve(null)
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target.result)
    reader.onerror = () => resolve(null)
    reader.readAsText(file)
  })
}

async function loadSelected() {
  if (!sdfFile.value) return
  const [sdfData, ndxText, itpText] = await Promise.all([
    readText(sdfFile.value),
    readText(ndxFile.value),
    readText(itpFile.value),
  ])
  emit('loadFiles', { sdfData, ndxText, itpText })
}
</script>
