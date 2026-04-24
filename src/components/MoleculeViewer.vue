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
            if (props.mapping.activeSection === 'bonds') {
              props.mapping.clearBondCandidate()
            } else {
              props.mapping.clearActiveBead()
            }
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

watch(() => props.mapping.activeBeadIndex, () => { updateVisualization() })
watch(() => props.mapping.beads, () => { updateVisualization() }, { deep: true })
watch(() => props.mapping.activeSection, () => { updateVisualization() })
watch(() => props.mapping.bonds, () => { updateVisualization() }, { deep: true })
watch(() => props.mapping.vsConnections, () => { updateVisualization() }, { deep: true })
watch(() => props.mapping.bondBeadCandidateIdx, () => { updateVisualization() })

function loadMolecule(data) {
  if (!viewer) return
  viewer.clear()
  viewer.addModel(data, "sdf")
  viewer.setStyle({}, {stick:{radius: 0.1}, sphere:{radius: 0.3}})
  viewer.setStyle({elem: 'H'}, {stick:{radius: 0.07}, sphere:{radius: 0.18}})

  viewer.setClickable({}, true, function(sel) {
    if (props.mapping.activeSection === 'bonds') return
    preventBgClick = true
    if (typeof sel.index !== 'undefined') {
      props.mapping.toggleAtom(sel.index, sel.elem || 'Unknown')
    }
  })

  viewer.zoomTo()
  viewer.render()
  moleculeLoaded.value = true
}

function updateVisualization() {
  if (!viewer || !moleculeLoaded.value) return

  const m = viewer.getModel()
  if (!m) return

  const isBondMode = props.mapping.activeSection === 'bonds'

  // Base atom styles — same stick thickness in both modes; bond mode uses grey to recede
  if (isBondMode) {
    viewer.setStyle({}, {stick:{radius: 0.1, color: '#bbbbbb'}, sphere:{radius: 0.18, color: '#bbbbbb'}})
    viewer.setStyle({elem: 'H'}, {stick:{radius: 0.07, color: '#dddddd'}, sphere:{radius: 0.12, color: '#dddddd'}})
  } else {
    viewer.setStyle({}, {stick:{radius: 0.1}, sphere:{radius: 0.3}})
    viewer.setStyle({elem: 'H'}, {stick:{radius: 0.07}, sphere:{radius: 0.18}})
  }

  // Colored atom sphere overlays — in bead mode, active bead gets larger radius
  props.mapping.beads.forEach((bead, idx) => {
    if (bead.atom_indices.length === 0) return
    const isActive = !isBondMode && props.mapping.activeBeadIndex === idx
    const heavyIndices = bead.atom_indices.filter((_, i) => bead.elements[i] !== 'H')
    const hIndices     = bead.atom_indices.filter((_, i) => bead.elements[i] === 'H')
    if (heavyIndices.length > 0)
      viewer.addStyle({index: heavyIndices}, {sphere: {color: bead.color, radius: isActive ? 0.45 : 0.3}})
    if (hIndices.length > 0)
      viewer.addStyle({index: hIndices},     {sphere: {color: bead.color, radius: isActive ? 0.28 : 0.18}})
  })

  // CG encompassing spheres (more opaque in bond mode) + bond cylinders
  viewer.removeAllShapes()
  props.mapping.beads.forEach((bead, idx) => {
    if (bead.atom_indices.length === 0 || !bead.cog) return
    const isCandidate = props.mapping.bondBeadCandidateIdx === idx
    viewer.addSphere({
      center: { x: bead.cog.x, y: bead.cog.y, z: bead.cog.z },
      radius: bead.radius || 1.4,
      color: bead.color,
      alpha: isBondMode ? (isCandidate ? 0.75 : 0.55) : 0.4
    })
  })

  // Regular bonds (grey) and constraint bonds (dark green)
  props.mapping.bonds.forEach(({ a, b, constraint }) => {
    const cogA = props.mapping.beads[a]?.cog
    const cogB = props.mapping.beads[b]?.cog
    if (!cogA || !cogB) return
    viewer.addCylinder({
      start: { x: cogA.x, y: cogA.y, z: cogA.z },
      end:   { x: cogB.x, y: cogB.y, z: cogB.z },
      radius: 0.12,
      color: constraint ? '#006400' : '#222222',
      alpha: 1.0,
      fromCap: 1,
      toCap: 1
    })
  })

  // Virtual site connections — dark blue, thinner cylinders
  Object.entries(props.mapping.vsConnections || {}).forEach(([vsIdxStr, neighbors]) => {
    const vsIdx = parseInt(vsIdxStr)
    const vsCog = props.mapping.beads[vsIdx]?.cog
    if (!vsCog) return
    neighbors.forEach(neighborIdx => {
      const nCog = props.mapping.beads[neighborIdx]?.cog
      if (!nCog) return
      viewer.addCylinder({
        start: { x: vsCog.x, y: vsCog.y, z: vsCog.z },
        end:   { x: nCog.x,  y: nCog.y,  z: nCog.z },
        radius: 0.07,
        color: '#00008B',
        alpha: 1.0,
        fromCap: 1,
        toCap: 1
      })
    })
  })

  // Bond mode: small clickable spheres at CG centers as bond targets
  // Candidate bead gets a white sphere; others get black
  if (isBondMode) {
    props.mapping.beads.forEach((bead, idx) => {
      if (bead.atom_indices.length === 0 || !bead.cog) return
      const isCandidate = props.mapping.bondBeadCandidateIdx === idx
      viewer.addSphere({
        center: { x: bead.cog.x, y: bead.cog.y, z: bead.cog.z },
        radius: isCandidate ? 0.22 : 0.16,
        color: isCandidate ? '#ffffff' : '#111111',
        alpha: 1.0,
        clickable: true,
        callback: function() {
          preventBgClick = true
          props.mapping.toggleBondBeadByIndex(idx)
        }
      })
    })
  }

  viewer.render()
}
</script>
