<template>
    <div class='d4h-popout d-flex flex-column'>
        <div
            class='d-flex align-items-center px-2 border-bottom flex-shrink-0'
            style='height: 50px;'
        >
            <D4HIcon
                class='flex-shrink-0'
                :size='20'
            />
            <span class='ms-2 text-truncate'>D4H</span>
        </div>
        <div class='flex-grow-1 min-height-0 overflow-auto'>
            <D4HPane />
        </div>
    </div>
</template>

<script setup lang='ts'>
import D4HIcon from '../../lib/D4HIcon.vue';
import D4HPane from '../D4HPane.vue';
</script>

<style>
.d4h-popout {
    height: 100vh;
    background-color: var(--tblr-bg-surface, #182433);
    color: var(--tblr-body-color, #dce1e7);
}
</style>
