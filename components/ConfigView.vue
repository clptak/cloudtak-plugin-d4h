<template>
    <div class='d-flex flex-column h-100 overflow-auto p-3'>
        <h5 class='mb-3'>D4H connection</h5>

        <form @submit.prevent='onSave'>
            <div class='row g-2'>
                <div class='col-12 col-md-4'>
                    <label class='form-label small fw-semibold'>Region</label>
                    <select v-model='form.region' class='form-select form-select-sm'>
                        <option value='us'>us</option>
                        <option value='eu'>eu</option>
                        <option value='ap'>ap</option>
                        <option value='ca'>ca</option>
                    </select>
                </div>
                <div class='col-12 col-md-4'>
                    <label class='form-label small fw-semibold'>Context</label>
                    <select v-model='form.context' class='form-select form-select-sm'>
                        <option value='team'>team</option>
                        <option value='organization'>organization</option>
                    </select>
                </div>
                <div class='col-12 col-md-4'>
                    <label class='form-label small fw-semibold'>Context ID</label>
                    <input
                        v-model.number='form.contextId'
                        type='number'
                        min='1'
                        class='form-control form-control-sm'
                        placeholder='e.g. 12345'
                        required
                    />
                </div>
            </div>

            <div class='mt-2'>
                <label class='form-label small fw-semibold'>
                    Base URL <span class='text-muted fw-normal'>(override — leave blank to use regional default)</span>
                </label>
                <input
                    v-model='form.baseUrl'
                    type='url'
                    class='form-control form-control-sm font-monospace'
                    :placeholder='regionDefaultUrl'
                />
            </div>

            <div class='mt-2'>
                <label class='form-label small fw-semibold'>D4H access token</label>
                <input
                    v-model='form.token'
                    type='password'
                    autocomplete='off'
                    class='form-control form-control-sm font-monospace'
                    placeholder='Paste D4H Bearer token'
                    required
                />
                <div class='form-text small'>
                    Stored locally via Capacitor Preferences (Keychain / EncryptedSharedPreferences on
                    native; localStorage on web). Never sent to the CloudTAK server.
                </div>
            </div>

            <div class='mt-3 d-flex gap-2 flex-wrap align-items-center'>
                <button type='submit' class='btn btn-primary btn-sm' :disabled='!canSubmit || saving'>
                    {{ saving ? 'Saving…' : 'Save' }}
                </button>
                <button
                    type='button'
                    class='btn btn-outline-secondary btn-sm'
                    :disabled='!canSubmit || testing'
                    @click='onTest'
                >
                    {{ testing ? 'Testing…' : 'Test connection' }}
                </button>
                <button
                    v-if='hasSaved'
                    type='button'
                    class='btn btn-outline-danger btn-sm ms-auto'
                    @click='onClear'
                >Clear saved config</button>
            </div>
        </form>

        <div v-if='status' class='alert alert-dismissible fade show alert-sm mt-3 small' :class='statusClass'>
            <button
                type='button'
                class='btn-close'
                aria-label='Close'
                @click='status = null'
            />
            <div class='fw-semibold'>{{ status.title }}</div>
            <div v-if='status.detail' style='white-space:pre-wrap'>{{ status.detail }}</div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, reactive, ref } from 'vue';
import {
    loadConfig, saveConfig, clearConfig, regionBaseUrl,
    type D4HConfig, type D4HRegion, type D4HContext,
} from '../lib/d4h-config.ts';
import { testConnection } from '../lib/d4h-client.ts';

const emit = defineEmits<{ (e: 'saved', config: D4HConfig): void; (e: 'cleared'): void }>();

interface FormState {
    region:    D4HRegion;
    baseUrl:   string;
    context:   D4HContext;
    contextId: number | null;
    token:     string;
}

const form = reactive<FormState>({
    region:    'us',
    baseUrl:   '',
    context:   'team',
    contextId: null,
    token:     '',
});

const saving   = ref(false);
const testing  = ref(false);
const hasSaved = ref(false);
const status   = ref<{ kind: 'ok' | 'err' | 'info'; title: string; detail?: string } | null>(null);

const regionDefaultUrl = computed(() => regionBaseUrl(form.region));
const canSubmit = computed(() =>
    !!form.region && !!form.context && !!form.token && typeof form.contextId === 'number' && form.contextId > 0
);
const statusClass = computed(() => ({
    'alert-success': status.value?.kind === 'ok',
    'alert-danger':  status.value?.kind === 'err',
    'alert-info':    status.value?.kind === 'info',
}));

onMounted(async () => {
    const existing = await loadConfig();
    if (existing) {
        form.region    = existing.region;
        form.baseUrl   = existing.baseUrl ?? '';
        form.context   = existing.context;
        form.contextId = existing.contextId;
        form.token     = existing.token;
        hasSaved.value = true;
    }
});

function buildConfig(): D4HConfig | null {
    if (!canSubmit.value || form.contextId == null) return null;
    return {
        region:    form.region,
        baseUrl:   form.baseUrl.trim() || undefined,
        context:   form.context,
        contextId: form.contextId,
        token:     form.token,
    };
}

async function onSave(): Promise<void> {
    const cfg = buildConfig();
    if (!cfg) return;
    saving.value = true;
    try {
        await saveConfig(cfg);
        hasSaved.value = true;
        status.value = { kind: 'ok', title: 'Saved.' };
        emit('saved', cfg);
    } catch (e) {
        status.value = { kind: 'err', title: 'Save failed.', detail: (e as Error).message };
    } finally {
        saving.value = false;
    }
}

async function onTest(): Promise<void> {
    const cfg = buildConfig();
    if (!cfg) return;
    testing.value = true;
    status.value = { kind: 'info', title: 'Calling D4H…' };
    try {
        const result = await testConnection(cfg);
        if (result.ok) {
            status.value = {
                kind:   'ok',
                title:  `Connected to ${result.baseUrl}.`,
                detail: result.sampleCount > 0
                    ? `Read ${result.sampleCount} member${result.sampleCount === 1 ? '' : 's'}${result.firstName ? ` — first: ${result.firstName}` : ''}.`
                    : 'Endpoint reachable but returned 0 members. Check the context/contextId.',
            };
        } else {
            status.value = {
                kind:   'err',
                title:  `Connection failed (${result.status ?? 'no response'}).`,
                detail: `${result.error}\nBase URL: ${result.baseUrl}`,
            };
        }
    } finally {
        testing.value = false;
    }
}

async function onClear(): Promise<void> {
    await clearConfig();
    form.baseUrl   = '';
    form.contextId = null;
    form.token     = '';
    hasSaved.value = false;
    status.value   = { kind: 'info', title: 'Cleared saved config.' };
    emit('cleared');
}
</script>
