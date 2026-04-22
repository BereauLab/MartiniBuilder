<template>
  <div class="col" style="position: relative; height: 100%;">
    <div ref="viewerDiv" style="width: 100%; height: 100%;"></div>
    <FileLoaderOverlay v-if="!moleculeLoaded" @loadSdf="mapping.loadSdf($event)" />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import FileLoaderOverlay from './FileLoaderOverlay.vue'

const props = defineProps({
  mapping: {
    type: Object,
    required: true
  }
})

const viewerDiv = ref(null)
let viewer = null
const moleculeLoaded = ref(false)

let isDragging = false
let preventBgClick = false
let mouseDownPos = {x: 0, y: 0}

onMounted(() => {
  if (window.$3Dmol) {
    viewer = window.$3Dmol.createViewer(viewerDiv.value, { backgroundColor: "white" })
    
    viewerDiv.value.addEventListener('mousedown', function(e) {
      mouseDownPos = {x: e.clientX, y: e.clientY}
      isDragging = false
    }, true)
    
    viewerDiv.value.addEventListener('mousemove', function(e) {
      if (Math.abs(e.clientX - mouseDownPos.x) > 5 || Math.abs(e.clientY - mouseDownPos.y) > 5) {
        isDragging = true
      }
    }, true)

    viewerDiv.value.addEventListener('mouseup', function(e) {
      if (!isDragging && e.button === 0) {
        setTimeout(() => {
          if (!preventBgClick) {
            props.mapping.clearActiveBead()
          }
          preventBgClick = false
        }, 50)
      }
    }, true)
  }
})

watch(() => props.mapping.sdfData, (newData) => {
  if (newData) loadMolecule(newData)
})

watch(() => props.mapping.activeBeadIndex, () => {
  updateVisualization()
})

watch(() => props.mapping.beads, () => {
  updateVisualization()
}, { deep: true })

function loadMolecule(data) {
  if (!viewer) return
  viewer.clear()
  viewer.addModel(data, "sdf")
  viewer.setStyle({}, {stick:{radius: 0.15}, sphere:{radius: 0.3}})
  viewer.setStyle({elem: 'H'}, {stick:{radius: 0.1}, sphere:{radius: 0.18}})

  viewer.setClickable({}, true, function(sel) {
    preventBgClick = true
    if(typeof sel.index !== 'undefined') {
      props.mapping.toggleAtom(sel.index, sel.elem || 'Unknown')
    }
  })
  
  viewer.zoomTo()
  viewer.render()
  moleculeLoaded.value = true
}

function updateVisualization() {
  if(!viewer || !moleculeLoaded.value) return

  const m = viewer.getModel()
  if (!m) return

  // Reset all atom styles to base
  viewer.setStyle({}, {stick:{radius: 0.15}, sphere:{radius: 0.3}})
  viewer.setStyle({elem: 'H'}, {stick:{radius: 0.1}, sphere:{radius: 0.18}})

  // Colored sphere overlay per bead: active = larger than base, inactive = same as base
  props.mapping.beads.forEach((bead, idx) => {
    if (bead.atom_indices.length === 0) return
    const isActive = (props.mapping.activeBeadIndex === idx)

    const heavyIndices = bead.atom_indices.filter((_, i) => bead.elements[i] !== 'H')
    const hIndices     = bead.atom_indices.filter((_, i) => bead.elements[i] === 'H')

    const heavyR = isActive ? 0.45 : 0.3
    const hR     = isActive ? 0.28 : 0.18

    if (heavyIndices.length > 0)
      viewer.addStyle({index: heavyIndices}, {sphere: {color: bead.color, radius: heavyR}})
    if (hIndices.length > 0)
      viewer.addStyle({index: hIndices},     {sphere: {color: bead.color, radius: hR}})
  })

  // CG encompassing spheres
  viewer.removeAllShapes()
  props.mapping.beads.forEach(bead => {
    if (bead.atom_indices.length === 0 || !bead.cog) return
    viewer.addSphere({
      center: { x: bead.cog.x, y: bead.cog.y, z: bead.cog.z },
      radius: bead.radius || 1.4,
      color: bead.color,
      alpha: 0.4
    })
  })

  viewer.render()
}
</script>
