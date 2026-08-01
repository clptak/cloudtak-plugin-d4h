<template>
    <TablerIconButton
        title='Pop out to separate window'
        @click='popOut'
    >
        <IconExternalLink
            :size='24'
            stroke='1'
        />
    </TablerIconButton>
</template>

<script setup lang='ts'>
import { IconExternalLink } from '@tabler/icons-vue';
import { TablerIconButton } from '@tak-ps/vue-tabler';
import { openPopout } from '../lib/popout.ts';
import { hideDesktopPane } from '../lib/floatPane.ts';

async function popOut(): Promise<void> {
    // Hide the float over the map (saving geometry) and hand the UI off to the
    // popout window. Keep the float if the popup was blocked.
    const opened = await openPopout();
    if (opened) hideDesktopPane();
}
</script>
