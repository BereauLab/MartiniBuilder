<template>
  <q-page class="row no-wrap" style="height: calc(100vh - 50px)">
    <MoleculeViewer :mapping="mapping" />
    <BeadSidebar :mapping="mapping" />
  </q-page>
</template>

<script setup>
import { reactive, onMounted } from 'vue'
import MoleculeViewer from 'components/MoleculeViewer.vue'
import BeadSidebar from 'components/BeadSidebar.vue'
import { MoleculeMapping } from '../models/MoleculeMapping.js'
import initRDKitModule from '@rdkit/rdkit'

// Use Vite's ?url suffix to dynamically get the resolved public asset path!
import rdkitWasmUrl from '@rdkit/rdkit/dist/RDKit_minimal.wasm?url'

// Setup the main MoleculeMapping instance
const mapping = reactive(new MoleculeMapping())

onMounted(() => {
  initRDKitModule({
    locateFile: () => rdkitWasmUrl
  }).then((RDKit) => {
    mapping.setRDKit(RDKit)
    console.log("RDKit initialized successfully and connected to mapping")
  }).catch(e => {
    console.error("Failed to initialize RDKit", e)
  })
})
</script>
