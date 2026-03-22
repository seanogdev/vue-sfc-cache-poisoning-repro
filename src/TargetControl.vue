<template>
  <div class="target-control">
    <ChildA v-if="show" />
    <ChildB v-if="show" />
  </div>
</template>
<script lang="ts">
export const meta = { name: 'TargetControl' }
</script>
<script setup lang="ts">
import ChildA from './ChildA.vue'
import ChildB from './ChildB.vue'

const props = defineProps<{ show: boolean }>()
</script>
