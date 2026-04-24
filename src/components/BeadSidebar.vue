<template>
  <div class="sidebar" :style="{ width: width + 'px' }">
    <div class="resize-handle" @mousedown.prevent="startResize" />
    <q-list class="full-width">

      <q-expansion-item group="sidebar" expand-separator icon="sym_o_scatter_plot" label="Bead Assignment & Types" default-opened @show="mapping.setActiveSection('beads')">
        <BeadAssignmentSection :mapping="mapping" />
      </q-expansion-item>

      <q-expansion-item group="sidebar" expand-separator icon="sym_o_diagonal_line" label="Bonds and Virtual Sites" @show="mapping.setActiveSection('bonds')">
        <BondsVirtualSitesSection :mapping="mapping" />
      </q-expansion-item>

      <q-expansion-item group="sidebar" expand-separator icon="share" label="Angles & Dihedrals" @show="mapping.setActiveSection('angles')">
        <AnglesSection :mapping="mapping" />
      </q-expansion-item>

      <q-expansion-item group="sidebar" expand-separator icon="output" label="Export" @show="mapping.setActiveSection('export')">
        <ExportSection :mapping="mapping" />
      </q-expansion-item>

    </q-list>
  </div>
</template>

<script setup>
import { ref, onBeforeUnmount } from 'vue'
import BeadAssignmentSection from './BeadAssignmentSection.vue'
import BondsVirtualSitesSection from './BondsVirtualSitesSection.vue'
import AnglesSection from './AnglesSection.vue'
import ExportSection from './ExportSection.vue'

defineProps({
  mapping: {
    type: Object,
    required: true
  }
})

const width = ref(400)
let startX = 0
let startWidth = 0

function startResize(e) {
  startX = e.clientX
  startWidth = width.value
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', stopResize)
}

function onMouseMove(e) {
  // Sidebar is on the right; dragging handle left widens it, right narrows it
  width.value = Math.max(280, Math.min(800, startWidth + (startX - e.clientX)))
}

function stopResize() {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', stopResize)
}

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', stopResize)
})
</script>

<style scoped>
.sidebar {
  position: relative;
  flex-shrink: 0;
  border-left: 1px solid #ccc;
  background: white;
  height: 100%;
  overflow-y: auto;
}
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.resize-handle:hover,
.resize-handle:active {
  background: rgba(0, 100, 255, 0.15);
}
</style>
