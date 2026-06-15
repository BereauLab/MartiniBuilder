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

function tryLoadCliSdf() {
  const api = window.pywebview?.api
  if (!api?.get_initial_sdf) return
  Promise.all([
    api.get_initial_sdf(),
    api.get_initial_ndx ? api.get_initial_ndx() : Promise.resolve(null),
    api.get_initial_itp ? api.get_initial_itp() : Promise.resolve(null),
  ]).then(([sdf, ndx, itp]) => {
    if (sdf) mapping.loadFiles(sdf, ndx, itp)
  })
}

onMounted(() => {
  initRDKitModule({
    locateFile: () => rdkitWasmUrl
  }).then((RDKit) => {
    mapping.setRDKit(RDKit)
    console.log("RDKit initialized successfully and connected to mapping")
  }).catch(e => {
    console.error("Failed to initialize RDKit", e)
  })

  // When running via the Python CLI, load the SDF passed on the command line.
  // pywebview fires 'pywebviewready' once its JS bridge is injected; if it is
  // already present (race condition won), call directly.
  window.addEventListener('pywebviewready', tryLoadCliSdf)
  tryLoadCliSdf()
})
</script>
