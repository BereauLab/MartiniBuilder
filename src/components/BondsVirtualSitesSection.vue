<template>
  <q-card>
    <q-card-section>

      <div class="text-caption text-grey-6 q-mb-sm">
        Click two bead spheres in the viewer to add or remove a bond.
      </div>

      <q-btn
        label="Auto-assign bonds & virtual sites"
        icon="auto_fix_high"
        dense
        outline
        color="primary"
        class="full-width q-mb-md"
        :disable="mapping.beads.length === 0"
        @click="mapping.autoAssignBondsAndVS()"
      />

      <!-- Bonds list -->
      <div class="text-subtitle2 q-mb-xs">Bonds</div>
      <q-list bordered separator dense class="rounded-borders q-mb-md">
        <q-item v-for="(bond, i) in mapping.bonds" :key="i" dense class="q-py-xs">
          <q-item-section>
            <div class="row items-center no-wrap" style="gap: 6px;">
              <q-avatar
                :style="{ backgroundColor: mapping.beads[bond.a]?.color }"
                size="12px"
              />
              <span class="text-caption">{{ mapping.beads[bond.a]?.type || ('Bead ' + (bond.a + 1)) }}</span>
              <span class="text-caption text-grey-5">—</span>
              <q-avatar
                :style="{ backgroundColor: mapping.beads[bond.b]?.color }"
                size="12px"
              />
              <span class="text-caption">{{ mapping.beads[bond.b]?.type || ('Bead ' + (bond.b + 1)) }}</span>
            </div>
          </q-item-section>
          <q-item-section side>
            <q-checkbox v-model="bond.constraint" dense size="xs" color="primary" label="constraint" />
          </q-item-section>
          <q-item-section side>
            <q-btn flat round dense icon="close" color="negative" size="xs"
                   @click="mapping.deleteBondAt(i)" />
          </q-item-section>
        </q-item>
        <q-item v-if="mapping.bonds.length === 0" dense>
          <q-item-section class="text-caption text-grey-5">No bonds assigned.</q-item-section>
        </q-item>
      </q-list>

      <!-- Virtual sites list -->
      <div class="row items-center q-mb-xs">
        <span class="text-subtitle2">Virtual Sites</span>
        <q-space />
        <q-btn
          label="Add as Virtual Site"
          dense
          flat
          size="sm"
          color="secondary"
          :disable="mapping.bondBeadCandidateIdx === null"
          @click="mapping.promoteToVirtualSite(mapping.bondBeadCandidateIdx)"
        />
      </div>
      <q-list bordered separator dense class="rounded-borders">
        <q-item v-for="vsIdx in mapping.virtualSites" :key="vsIdx" dense class="q-py-xs">
          <q-item-section>
            <div class="row items-center no-wrap q-mb-xs" style="gap: 6px;">
              <q-avatar :style="{ backgroundColor: mapping.beads[vsIdx]?.color }" size="12px" />
              <span class="text-caption text-weight-medium">Bead {{ vsIdx + 1 }}</span>
            </div>
            <div class="row items-center no-wrap" style="gap: 4px; flex-wrap: wrap;">
              <span class="text-caption text-grey-6">defined by</span>
              <template v-for="(nIdx, i) in (mapping.vsConnections[vsIdx] || [])" :key="nIdx">
                <span v-if="i > 0" class="text-caption text-grey-5">,</span>
                <q-avatar :style="{ backgroundColor: mapping.beads[nIdx]?.color }" size="10px" />
                <span class="text-caption">{{ nIdx + 1 }}</span>
              </template>
            </div>
          </q-item-section>
          <q-item-section side>
            <q-btn flat round dense icon="close" color="negative" size="xs"
                   @click="mapping.removeVirtualSite(vsIdx)" />
          </q-item-section>
        </q-item>
        <q-item v-if="mapping.virtualSites.length === 0" dense>
          <q-item-section class="text-caption text-grey-5">No virtual sites assigned.</q-item-section>
        </q-item>
      </q-list>

    </q-card-section>
  </q-card>
</template>

<script setup>
defineProps({
  mapping: {
    type: Object,
    required: true
  }
})
</script>
