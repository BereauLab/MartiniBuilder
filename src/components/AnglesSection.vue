<template>
  <q-card>
    <q-card-section>

      <div class="text-caption text-grey-6 q-mb-sm">
        Click bead spheres in the viewer to build angles and dihedrals.
      </div>

      <q-btn
        label="Auto-assign angles & dihedrals"
        icon="auto_fix_high"
        dense
        outline
        color="primary"
        class="full-width q-mb-md"
        :disable="mapping.beads.length < 3"
        @click="mapping.autoAssignAnglesAndDihedrals()"
      />

      <!-- Angles -->
      <div class="row items-center q-mb-xs">
        <span class="text-subtitle2">Angles</span>
        <q-space />
        <q-btn
          :label="mapping.angleMode === 'angle' ? 'Cancel' : 'Add Angle'"
          dense size="sm"
          :color="mapping.angleMode === 'angle' ? 'orange-8' : 'primary'"
          :unelevated="mapping.angleMode === 'angle'"
          :outline="mapping.angleMode !== 'angle'"
          :disable="mapping.beads.length < 3"
          @click="mapping.setAngleMode('angle')"
        />
      </div>

      <div v-if="mapping.angleMode === 'angle'" class="row items-center q-mb-xs" style="gap: 4px; flex-wrap: wrap;">
        <template v-for="(beadIdx, i) in mapping.angleCandidates" :key="i">
          <q-icon v-if="i > 0" name="arrow_forward" size="10px" color="grey-6" />
          <q-avatar :style="{ backgroundColor: mapping.beads[beadIdx]?.color }" size="10px" />
          <span class="text-caption">{{ mapping.beads[beadIdx]?.type || ('Bead ' + (beadIdx + 1)) }}</span>
        </template>
        <span class="text-caption text-grey-5">
          {{ mapping.angleCandidates.length === 0 ? 'Click 3 beads' : `${3 - mapping.angleCandidates.length} more` }}
        </span>
      </div>

      <q-list bordered separator dense class="rounded-borders q-mb-md">
        <q-item v-for="(angle, i) in mapping.angles" :key="i" dense class="q-py-xs">
          <q-item-section>
            <div class="row items-center no-wrap" style="gap: 4px;">
              <template v-for="(beadIdx, j) in angle" :key="j">
                <span v-if="j > 0" class="text-caption text-grey-5">–</span>
                <q-avatar :style="{ backgroundColor: mapping.beads[beadIdx]?.color }" size="10px" />
                <span class="text-caption">{{ mapping.beads[beadIdx]?.type || ('Bead ' + (beadIdx + 1)) }}</span>
              </template>
            </div>
          </q-item-section>
          <q-item-section side>
            <q-btn flat round dense icon="close" color="negative" size="xs" @click="mapping.deleteAngleAt(i)" />
          </q-item-section>
        </q-item>
        <q-item v-if="mapping.angles.length === 0" dense>
          <q-item-section class="text-caption text-grey-5">No angles assigned.</q-item-section>
        </q-item>
      </q-list>

      <!-- Improper Dihedrals -->
      <div class="row items-center q-mb-xs">
        <span class="text-subtitle2">Improper Dihedrals</span>
        <q-space />
        <q-btn
          :label="mapping.angleMode === 'dihedral' ? 'Cancel' : 'Add Improper'"
          dense size="sm"
          :color="mapping.angleMode === 'dihedral' ? 'orange-8' : 'primary'"
          :unelevated="mapping.angleMode === 'dihedral'"
          :outline="mapping.angleMode !== 'dihedral'"
          :disable="mapping.beads.length < 4"
          @click="mapping.setAngleMode('dihedral')"
        />
      </div>

      <div v-if="mapping.angleMode === 'dihedral'" class="row items-center q-mb-xs" style="gap: 4px; flex-wrap: wrap;">
        <template v-for="(beadIdx, i) in mapping.angleCandidates" :key="i">
          <q-icon v-if="i > 0" name="arrow_forward" size="10px" color="grey-6" />
          <q-avatar :style="{ backgroundColor: mapping.beads[beadIdx]?.color }" size="10px" />
          <span class="text-caption">{{ mapping.beads[beadIdx]?.type || ('Bead ' + (beadIdx + 1)) }}</span>
        </template>
        <span class="text-caption text-grey-5">
          {{ mapping.angleCandidates.length === 0 ? 'Click 4 beads' : `${4 - mapping.angleCandidates.length} more` }}
        </span>
      </div>

      <q-list bordered separator dense class="rounded-borders q-mb-md">
        <q-item v-for="(dihedral, i) in mapping.dihedrals" :key="i" dense class="q-py-xs">
          <q-item-section>
            <div class="row items-center no-wrap" style="gap: 4px;">
              <template v-for="(beadIdx, j) in dihedral" :key="j">
                <span v-if="j > 0" class="text-caption text-grey-5">–</span>
                <q-avatar :style="{ backgroundColor: mapping.beads[beadIdx]?.color }" size="10px" />
                <span class="text-caption">{{ mapping.beads[beadIdx]?.type || ('Bead ' + (beadIdx + 1)) }}</span>
              </template>
            </div>
          </q-item-section>
          <q-item-section side>
            <q-btn flat round dense icon="close" color="negative" size="xs" @click="mapping.deleteDihedralAt(i)" />
          </q-item-section>
        </q-item>
        <q-item v-if="mapping.dihedrals.length === 0" dense>
          <q-item-section class="text-caption text-grey-5">No improper dihedrals assigned.</q-item-section>
        </q-item>
      </q-list>

      <!-- Proper Dihedrals -->
      <div class="row items-center q-mb-xs">
        <span class="text-subtitle2">Proper Dihedrals</span>
        <q-space />
        <q-btn
          :label="mapping.angleMode === 'proper' ? 'Cancel' : 'Add Proper'"
          dense size="sm"
          :color="mapping.angleMode === 'proper' ? 'orange-8' : 'primary'"
          :unelevated="mapping.angleMode === 'proper'"
          :outline="mapping.angleMode !== 'proper'"
          :disable="mapping.beads.length < 4"
          @click="mapping.setAngleMode('proper')"
        />
      </div>

      <div v-if="mapping.angleMode === 'proper'" class="row items-center q-mb-xs" style="gap: 4px; flex-wrap: wrap;">
        <template v-for="(beadIdx, i) in mapping.angleCandidates" :key="i">
          <q-icon v-if="i > 0" name="arrow_forward" size="10px" color="grey-6" />
          <q-avatar :style="{ backgroundColor: mapping.beads[beadIdx]?.color }" size="10px" />
          <span class="text-caption">{{ mapping.beads[beadIdx]?.type || ('Bead ' + (beadIdx + 1)) }}</span>
        </template>
        <span class="text-caption text-grey-5">
          {{ mapping.angleCandidates.length === 0 ? 'Click 4 beads' : `${4 - mapping.angleCandidates.length} more` }}
        </span>
      </div>

      <q-list bordered separator dense class="rounded-borders">
        <q-item v-for="(dihedral, i) in mapping.properDihedrals" :key="i" dense class="q-py-xs">
          <q-item-section>
            <div class="row items-center no-wrap" style="gap: 4px;">
              <template v-for="(beadIdx, j) in dihedral" :key="j">
                <span v-if="j > 0" class="text-caption text-grey-5">–</span>
                <q-avatar :style="{ backgroundColor: mapping.beads[beadIdx]?.color }" size="10px" />
                <span class="text-caption">{{ mapping.beads[beadIdx]?.type || ('Bead ' + (beadIdx + 1)) }}</span>
              </template>
            </div>
          </q-item-section>
          <q-item-section side>
            <q-btn flat round dense icon="close" color="negative" size="xs" @click="mapping.deleteProperDihedralAt(i)" />
          </q-item-section>
        </q-item>
        <q-item v-if="mapping.properDihedrals.length === 0" dense>
          <q-item-section class="text-caption text-grey-5">No proper dihedrals assigned.</q-item-section>
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
