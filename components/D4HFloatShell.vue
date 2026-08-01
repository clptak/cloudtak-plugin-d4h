<template>
    <FloatingPane
        :uid='uid'
        @close='emit("close")'
    >
        <template #header>
            <div
                class='mx-2 text-sm text-truncate d-flex align-items-center gap-2'
                style='max-width: calc(100% - 100px);'
            >
                <D4HIcon
                    class='flex-shrink-0'
                    :size='20'
                />
                <span>D4H</span>
            </div>
        </template>

        <template #actions>
            <PopoutPaneAction />
        </template>

        <div class='h-100 w-100 overflow-auto'>
            <D4HPane />
        </div>
    </FloatingPane>
</template>

<script setup lang='ts'>
import FloatingPane from '../../../src/components/CloudTAK/util/FloatingPane.vue';
import D4HIcon from '../lib/D4HIcon.vue';
import D4HPane from './D4HPane.vue';
import PopoutPaneAction from './PopoutPaneAction.vue';

defineProps({
    uid: {
        type: String,
        required: true,
    },
});

const emit = defineEmits(['close']);
</script>
