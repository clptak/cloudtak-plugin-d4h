<template>
    <MenuTemplate name='D4H'>
        <template #header>
            <D4HIcon :size='22' />
            <span class='fw-semibold ms-2'>D4H</span>
        </template>

        <D4HPane />
    </MenuTemplate>
</template>

<script setup lang='ts'>
import MenuTemplate from '../lib/MenuTemplate.vue';
import D4HIcon from '../lib/D4HIcon.vue';
import D4HPane from './D4HPane.vue';
</script>
