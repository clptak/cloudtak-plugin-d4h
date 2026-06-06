<template>
    <img
        :src='iconUrl'
        :width='size'
        :height='size'
        alt='D4H'
        style='display: block;'
    >
</template>

<script setup lang='ts'>
import iconUrl from './assets/d4h_personnel_logo.svg';

defineProps({
    size: { type: [String, Number], default: 32 },
});
</script>
