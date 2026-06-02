<template>
  <q-card>
    <q-card-section>
      <div class="row q-mb-md">
        <q-file
          v-model="mappingFile"
          label="Load JSON Bead Type Assignment File"
          outlined
          dense
          accept=".json"
          @update:model-value="onMappingFileChange"
          class="col-12"
        >
          <template v-slot:prepend>
            <q-icon name="upload_file" />
          </template>
        </q-file>
      </div>

      <div class="text-caption q-mb-sm">Click atoms to build beads. Unselect to start a new bead.</div>

      <q-list bordered separator class="rounded-borders">
        <q-item
          v-for="(bead, idx) in mapping.beads"
          :key="idx"
          clickable
          dense
          :active="mapping.activeBeadIndex === idx"
          active-class="bg-grey-3"
          @click="mapping.setActiveBead(idx)"
          class="column q-py-sm"
        >
          <!-- Header row: Avatar + Input + Delete -->
          <div class="row items-center justify-between full-width no-wrap">
            <div class="row items-center no-wrap">
              <q-avatar :style="{ backgroundColor: bead.color, color: 'white' }" size="sm" class="q-mr-sm" />
              <span class="text-caption text-weight-medium">Bead {{ idx + 1 }}</span>
            </div>
            <div class="row items-center no-wrap">
              <div @click.stop="openMenu(idx)" style="width: 80px">
                <q-input
                  v-model="bead.type"
                  dense
                  outlined
                  placeholder="Type"
                  class="q-mr-xs"
                  style="width: 80px; font-size: 14px"
                  @blur="closeMenu(idx)"
                />
                <q-menu
                  :ref="el => { if (el) menuRefs[idx] = el }"
                  no-focus
                  no-refocus
                  no-parent-event
                  fit
                >
                  <q-list dense>
                    <q-item
                      v-for="opt in getTypeOptions(bead)"
                      :key="opt"
                      clickable
                      @mousedown.prevent
                      @click="bead.type = opt; closeMenu(idx)"
                    >
                      <q-item-section>{{ opt }}</q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </div>
              <q-btn flat round dense icon="close" color="negative" size="xs" @click.stop="mapping.deleteBead(idx)" />
            </div>
          </div>

          <!-- Compact atom chips -->
          <div v-if="bead.properties && bead.properties.length > 0" class="row q-mt-sm" style="gap: 5px; flex-wrap: wrap;">
            <div
              v-for="(prop, propIdx) in bead.properties"
              :key="propIdx"
              class="atom-chip row items-center no-wrap"
            >
              <span class="text-weight-bold">{{ prop.element }}</span>
              <span class="chip-sep" />
              <span class="row items-center no-wrap chip-prop">
                <q-icon name="sym_o_diagonal_line" size="11px" color="grey-6" />{{ prop.bonds }}
              </span>
              <span class="chip-sep" />
              <span class="chip-prop">{{ prop.hydrogens }}&nbsp;H</span>
              <template v-if="prop.charge !== 0">
                <span class="chip-sep" />
                <span class="chip-prop chip-charge" :class="prop.charge > 0 ? 'charge-pos' : 'charge-neg'">
                  {{ prop.charge > 0 ? '+' : '' }}{{ prop.charge }}
                </span>
              </template>
              <template v-if="prop.aromatic">
                <span class="chip-sep" />
                <span class="chip-icon-wrap">
                  <svg class="arom-ring" width="13" height="13" viewBox="0 0 14 14">
                    <polygon points="13,7 10,12.2 4,12.2 1,7 4,1.8 10,1.8" fill="none" stroke="currentColor" stroke-width="1.4"/>
                    <circle cx="7" cy="7" r="2.6" fill="none" stroke="currentColor" stroke-width="1.1"/>
                  </svg>
                  <q-tooltip :delay="400" class="text-caption">Aromatic</q-tooltip>
                </span>
              </template>
              <template v-if="prop.shared">
                <span class="chip-sep" />
                <span class="chip-icon-wrap">
                  <svg class="shared-half" width="13" height="13" viewBox="0 0 14 14">
                    <path d="M7,1 A6,6 0 0,1 7,13 L7,1 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
                  </svg>
                  <q-tooltip :delay="400" class="text-caption">Shared between beads</q-tooltip>
                </span>
              </template>
            </div>
          </div>
          <div v-else class="text-caption text-grey-5 q-mt-xs">No heavy atoms.</div>

        </q-item>
      </q-list>

      <div v-if="mapping.beads.length === 0" class="text-grey-6 text-center q-mt-md">
        No beads created yet.
      </div>
    </q-card-section>
  </q-card>
</template>

<script setup>
import { ref, nextTick, onMounted } from 'vue'

const props = defineProps({
  mapping: {
    type: Object,
    required: true
  }
})

const mappingFile = ref(null)

onMounted(() => {
  function tryLoadCliMapping() {
    window.pywebview?.api?.get_initial_mapping().then(json => {
      if (json) props.mapping.loadMappingRulesFromJson(json)
    })
  }
  window.addEventListener('pywebviewready', tryLoadCliMapping)
  tryLoadCliMapping()
})
const menuRefs = {}

function onMappingFileChange(file) {
  if (file) {
    props.mapping.loadMappingRules(file)
  }
}

function getTypeOptions(bead) {
  return props.mapping.combinedMappings[bead.signature] || []
}

function openMenu(idx) {
  const bead = props.mapping.beads[idx]
  if (!bead || getTypeOptions(bead).length === 0) return
  nextTick(() => { menuRefs[idx]?.show() })
}

function closeMenu(idx) {
  menuRefs[idx]?.hide()
}
</script>

<style scoped>
.atom-chip {
  font-size: 11px;
  background: white;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 3px 8px;
  gap: 5px;
}
.chip-sep {
  width: 1px;
  height: 12px;
  background: #ccc;
  flex-shrink: 0;
}
.chip-prop {
  color: #555;
  gap: 2px;
}
.charge-pos { color: #b00; font-weight: 600; }
.charge-neg { color: #00b; font-weight: 600; }
.chip-icon-wrap {
  display: inline-flex;
  align-items: center;
  position: relative;
}
.arom-ring {
  display: block;
  color: #222;
}
.shared-half {
  display: block;
  color: #555;
}
</style>
