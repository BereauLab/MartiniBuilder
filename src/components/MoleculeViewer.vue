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
      document.activeElement?.blur()
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
            } else if (props.mapping.activeSection === 'angles') {
              props.mapping.clearAngleCandidates()
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
watch(() => props.mapping.angleCandidates, () => { updateVisualization() }, { deep: true })
watch(() => props.mapping.angleMode, () => { updateVisualization() })
watch(() => props.mapping.angles, () => { updateVisualization() }, { deep: true })

function loadMolecule(data) {
  if (!viewer) return
  viewer.clear()
  viewer.addModel(data, "sdf")
  viewer.setStyle({}, {stick:{radius: 0.1}, sphere:{radius: 0.3}})
  viewer.setStyle({elem: 'H'}, {stick:{radius: 0.07}, sphere:{radius: 0.18}})

  viewer.setClickable({}, true, function(sel) {
    if (props.mapping.activeSection === 'bonds' || props.mapping.activeSection === 'angles') return
    preventBgClick = true
    if (typeof sel.index !== 'undefined') {
      props.mapping.toggleAtom(sel.index, sel.elem || 'Unknown')
      updateVisualization()
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

  const isBondMode  = props.mapping.activeSection === 'bonds'
  const isAngleMode = props.mapping.activeSection === 'angles'
  const isCgMode    = isBondMode || isAngleMode

  // Base atom styles — grey and receded in CG-interaction modes
  if (isCgMode) {
    viewer.setStyle({}, {stick:{radius: 0.1, color: '#bbbbbb'}, sphere:{radius: 0.18, color: '#bbbbbb'}})
    viewer.setStyle({elem: 'H'}, {stick:{radius: 0.07, color: '#dddddd'}, sphere:{radius: 0.12, color: '#dddddd'}})
  } else {
    viewer.setStyle({}, {stick:{radius: 0.1}, sphere:{radius: 0.3}})
    viewer.setStyle({elem: 'H'}, {stick:{radius: 0.07}, sphere:{radius: 0.18}})
  }

  // Colored atom sphere overlays — active bead gets larger radius only in bead-assign mode
  props.mapping.beads.forEach((bead, idx) => {
    if (bead.atom_indices.length === 0) return
    const isActive = !isCgMode && props.mapping.activeBeadIndex === idx
    const heavyIndices = bead.atom_indices.filter((_, i) => bead.elements[i] !== 'H')
    const hIndices     = bead.atom_indices.filter((_, i) => bead.elements[i] === 'H')
    if (heavyIndices.length > 0)
      viewer.addStyle({index: heavyIndices}, {sphere: {color: bead.color, radius: isActive ? 0.45 : 0.3}})
    if (hIndices.length > 0)
      viewer.addStyle({index: hIndices},     {sphere: {color: bead.color, radius: isActive ? 0.28 : 0.18}})
  })

  // CG encompassing spheres
  viewer.removeAllShapes()
  props.mapping.beads.forEach((bead, idx) => {
    if (bead.atom_indices.length === 0 || !bead.cog) return
    const isCandidate = isBondMode
      ? props.mapping.bondBeadCandidateIdx === idx
      : props.mapping.angleCandidates.includes(idx)
    viewer.addSphere({
      center: { x: bead.cog.x, y: bead.cog.y, z: bead.cog.z },
      radius: bead.radius || 1.4,
      color: bead.color,
      alpha: isCgMode ? (isCandidate ? 0.75 : 0.55) : 0.4
    })
  })

  // Regular bonds — orange in angle mode, otherwise grey/green by constraint flag
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

  // Bond/angle mode: small clickable spheres at CG centers
  // Selected candidates get a white sphere; others get black
  if (isCgMode) {
    props.mapping.beads.forEach((bead, idx) => {
      if (bead.atom_indices.length === 0 || !bead.cog) return
      const isCandidate = isBondMode
        ? props.mapping.bondBeadCandidateIdx === idx
        : props.mapping.angleCandidates.includes(idx)
      viewer.addSphere({
        center: { x: bead.cog.x, y: bead.cog.y, z: bead.cog.z },
        radius: isCandidate ? 0.22 : 0.16,
        color: isCandidate ? '#ffffff' : '#111111',
        alpha: 1.0,
        clickable: true,
        callback: function() {
          preventBgClick = true
          if (isBondMode) props.mapping.toggleBondBeadByIndex(idx)
          else props.mapping.toggleAngleBead(idx)
          updateVisualization()
        }
      })
    })
  }

  // Angle arcs — thin arc at the middle bead between the two bond directions
  props.mapping.angles.forEach(([a, b, c]) => {
    const cogA = props.mapping.beads[a]?.cog
    const cogB = props.mapping.beads[b]?.cog
    const cogC = props.mapping.beads[c]?.cog
    if (!cogA || !cogB || !cogC) return
    _drawArc(viewer, cogA, cogB, cogC, '#FF6600')
  })

  viewer.render()
}

function _drawArc(viewer, cogA, cogB, cogC, color) {
  const ax = cogA.x - cogB.x, ay = cogA.y - cogB.y, az = cogA.z - cogB.z
  const cx = cogC.x - cogB.x, cy = cogC.y - cogB.y, cz = cogC.z - cogB.z
  const lenA = Math.sqrt(ax*ax + ay*ay + az*az)
  const lenC = Math.sqrt(cx*cx + cy*cy + cz*cz)
  if (lenA === 0 || lenC === 0) return
  const uA = { x: ax/lenA, y: ay/lenA, z: az/lenA }
  const uC = { x: cx/lenC, y: cy/lenC, z: cz/lenC }

  const dot = Math.max(-1, Math.min(1, uA.x*uC.x + uA.y*uC.y + uA.z*uC.z))
  const angle = Math.acos(dot)
  if (angle < 0.01) return

  const arcRadius = Math.min(lenA, lenC) * 0.35
  const sinAngle = Math.sin(angle)
  const N = 16
  const pts = []
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const w1 = Math.sin((1 - t) * angle) / sinAngle
    const w2 = Math.sin(t * angle) / sinAngle
    pts.push({
      x: cogB.x + (w1 * uA.x + w2 * uC.x) * arcRadius,
      y: cogB.y + (w1 * uA.y + w2 * uC.y) * arcRadius,
      z: cogB.z + (w1 * uA.z + w2 * uC.z) * arcRadius
    })
  }
  for (let i = 0; i < N; i++) {
    viewer.addCylinder({
      start: pts[i], end: pts[i + 1],
      radius: 0.04, color, alpha: 1.0, fromCap: 0, toCap: 0
    })
  }
}
</script>
