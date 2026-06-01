<template>
  <q-card>
    <q-card-section>

      <div class="text-caption text-grey-6 q-mb-md">
        Export the current mapping as GROMACS-compatible files.
      </div>

      <q-list bordered separator dense class="rounded-borders">

        <q-item dense class="q-py-sm">
          <q-item-section>
            <div class="text-caption text-weight-medium">Atom–bead mapping</div>
            <div class="text-caption text-grey-6">.ndx — all-atom indices per bead group</div>
          </q-item-section>
          <q-item-section side>
            <q-btn dense outline size="sm" color="primary" label="Download .ndx"
                   :disable="mapping.beads.length === 0"
                   @click="download('ndx')" />
          </q-item-section>
        </q-item>

        <q-item dense class="q-py-sm">
          <q-item-section>
            <div class="text-caption text-weight-medium">CG structure</div>
            <div class="text-caption text-grey-6">.gro — bead positions (COG, in nm)</div>
          </q-item-section>
          <q-item-section side>
            <q-btn dense outline size="sm" color="primary" label="Download .gro"
                   :disable="mapping.beads.length === 0"
                   @click="download('gro')" />
          </q-item-section>
        </q-item>

        <q-item dense class="q-py-sm">
          <q-item-section>
            <div class="text-caption text-weight-medium">Topology</div>
            <div class="text-caption text-grey-6">.itp — bonds, constraints, angles, dihedrals, VS, exclusions</div>
          </q-item-section>
          <q-item-section side>
            <q-btn dense outline size="sm" color="primary" label="Download .itp"
                   :disable="mapping.beads.length === 0"
                   @click="download('itp')" />
          </q-item-section>
        </q-item>

        <q-item dense class="q-py-sm">
          <q-item-section>
            <div class="text-caption text-weight-medium">Bead-type mapping rules</div>
            <div class="text-caption text-grey-6">.json — combined default + uploaded + manual rules</div>
          </q-item-section>
          <q-item-section side>
            <q-btn dense outline size="sm" color="primary" label="Download .json"
                   :disable="mapping.beads.length === 0"
                   @click="download('json')" />
          </q-item-section>
        </q-item>

      </q-list>

    </q-card-section>
  </q-card>
</template>

<script setup>
import {
  generateNdx,
  generateGro,
  generateItp,
  generateMappingJson,
  downloadFile
} from '../models/ExportFormatter.js'

const props = defineProps({
  mapping: {
    type: Object,
    required: true
  }
})

function download(type) {
  switch (type) {
    case 'ndx':  return downloadFile(generateNdx(props.mapping),         'mapping.ndx');
    case 'gro':  return downloadFile(generateGro(props.mapping),         'ligand.gro');
    case 'itp':  return downloadFile(generateItp(props.mapping),         'ligand.itp');
    case 'json': return downloadFile(generateMappingJson(props.mapping), 'bead-mapping.json');
  }
}
</script>
