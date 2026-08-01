<template>
    <div class='d-flex flex-column p-3'>
        <!-- Server sync (hybrid) -->
        <div class='mb-4'>
            <h5 class='mb-2'>
                Server sync (shared)
            </h5>
            <p class='small text-muted mb-2'>
                When configured, CloudTAK pulls D4H on a schedule into Postgres. Every operator
                gets a fast refresh instead of each browser crawling D4H.
            </p>

            <div
                v-if='serverAvailable === null'
                class='text-muted small mb-2'
            >
                Checking CloudTAK server route…
            </div>

            <div
                v-else-if='serverAvailable === false'
                class='alert alert-secondary small mb-0'
            >
                Server route not installed. Use local config below, or run
                <code>scripts/install.sh</code> and rebuild the API image.
            </div>

            <template v-else>
                <div
                    v-if='!isSystemAdmin'
                    class='alert alert-info small'
                >
                    Server sync is
                    <strong>{{ serverForm.tokenConfigured ? 'configured' : 'not configured' }}</strong>.
                    <span v-if='serverForm.lastSyncAt'>
                        Last server sync:
                        {{ serverForm.lastSyncAt }}
                        <span v-if='serverForm.lastSyncStatus'>({{ serverForm.lastSyncStatus }})</span>.
                    </span>
                    Only a system admin can edit server credentials.
                </div>

                <form
                    v-else
                    @submit.prevent='onSaveServer'
                >
                    <div class='row g-2'>
                        <div class='col-12 col-md-4'>
                            <label class='form-label small fw-semibold'>Region</label>
                            <select
                                v-model='serverForm.region'
                                class='form-select form-select-sm'
                            >
                                <option value='us'>
                                    us
                                </option>
                                <option value='eu'>
                                    eu
                                </option>
                                <option value='ap'>
                                    ap
                                </option>
                                <option value='ca'>
                                    ca
                                </option>
                            </select>
                        </div>
                        <div class='col-12 col-md-4'>
                            <label class='form-label small fw-semibold'>Context</label>
                            <select
                                v-model='serverForm.context'
                                class='form-select form-select-sm'
                            >
                                <option value='team'>
                                    team
                                </option>
                                <option value='organization'>
                                    organization
                                </option>
                            </select>
                        </div>
                        <div class='col-12 col-md-4'>
                            <label class='form-label small fw-semibold'>Context ID</label>
                            <input
                                v-model.number='serverForm.contextId'
                                type='number'
                                min='1'
                                class='form-control form-control-sm'
                                placeholder='e.g. 123'
                                required
                            >
                        </div>
                    </div>

                    <div class='mt-2'>
                        <label class='form-label small fw-semibold'>
                            Base URL <span class='text-muted fw-normal'>(optional override)</span>
                        </label>
                        <input
                            v-model='serverForm.baseUrl'
                            type='url'
                            class='form-control form-control-sm font-monospace'
                            :placeholder='serverRegionDefaultUrl'
                        >
                    </div>

                    <div class='mt-2'>
                        <label class='form-label small fw-semibold'>D4H token (server-held)</label>
                        <input
                            v-model='serverForm.token'
                            type='password'
                            autocomplete='off'
                            class='form-control form-control-sm font-monospace'
                            :placeholder='serverForm.tokenConfigured ? "(unchanged — paste to replace)" : "Paste D4H Bearer token"'
                        >
                        <div class='form-text small'>
                            Stored in CloudTAK Postgres — never written to browser cache.
                            Leave blank to keep the existing token.
                        </div>
                    </div>

                    <div class='mt-2'>
                        <label class='form-label small fw-semibold'>Default TAK groups</label>
                        <input
                            v-model='serverForm.defaultGroupsText'
                            type='text'
                            class='form-control form-control-sm'
                            placeholder='e.g. __ANON__, Team Alpha'
                        >
                        <div class='form-text small'>
                            Comma-separated TAK channel names applied to every synced row.
                            Callers only see rows whose groups intersect theirs.
                        </div>
                    </div>

                    <div class='mt-2 col-12 col-md-4'>
                        <label class='form-label small fw-semibold'>Sync interval (minutes)</label>
                        <input
                            v-model.number='serverForm.syncIntervalMinutes'
                            type='number'
                            min='15'
                            max='1440'
                            class='form-control form-control-sm'
                        >
                        <div class='form-text small'>
                            Clamped 15–1440. In-process timer (single API replica); external cron can also
                            <code>POST /api/d4h/sync</code>.
                        </div>
                    </div>

                    <div
                        v-if='serverForm.lastSyncAt'
                        class='small text-muted mt-2'
                    >
                        Last server sync: {{ serverForm.lastSyncAt }}
                        <span v-if='serverForm.lastSyncStatus'>({{ serverForm.lastSyncStatus }})</span>
                        <span
                            v-if='serverForm.lastSyncError'
                            class='text-danger d-block'
                        >{{ serverForm.lastSyncError }}</span>
                    </div>

                    <div class='mt-3 d-flex gap-2 flex-wrap'>
                        <button
                            type='submit'
                            class='btn btn-primary btn-sm'
                            :disabled='!canSubmitServer || serverSaving'
                        >
                            {{ serverSaving ? 'Saving…' : 'Save server config' }}
                        </button>
                        <button
                            v-if='serverForm.tokenConfigured'
                            type='button'
                            class='btn btn-outline-danger btn-sm'
                            :disabled='serverSaving'
                            @click='onClearServerToken'
                        >
                            Clear server token
                        </button>
                    </div>
                </form>
            </template>
        </div>

        <hr class='my-2'>

        <h5 class='mb-3'>
            Local D4H connection
            <span class='text-muted fw-normal small'>(fallback / writes)</span>
        </h5>
        <p class='small text-muted mb-2'>
            Used for Submit Incident/Roster/Subject and for Sync when the server route is not configured.
        </p>

        <form @submit.prevent='onSave'>
            <div class='row g-2'>
                <div class='col-12 col-md-4'>
                    <label class='form-label small fw-semibold'>Region</label>
                    <select
                        v-model='form.region'
                        class='form-select form-select-sm'
                    >
                        <option value='us'>
                            us
                        </option>
                        <option value='eu'>
                            eu
                        </option>
                        <option value='ap'>
                            ap
                        </option>
                        <option value='ca'>
                            ca
                        </option>
                    </select>
                </div>
                <div class='col-12 col-md-4'>
                    <label class='form-label small fw-semibold'>Context</label>
                    <select
                        v-model='form.context'
                        class='form-select form-select-sm'
                    >
                        <option value='team'>
                            team
                        </option>
                        <option value='organization'>
                            organization
                        </option>
                    </select>
                </div>
                <div class='col-12 col-md-4'>
                    <label class='form-label small fw-semibold'>Context ID</label>
                    <input
                        v-model.number='form.contextId'
                        type='number'
                        min='1'
                        class='form-control form-control-sm'
                        placeholder='e.g. 123'
                        required
                    >
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
                >
            </div>

            <div class='mt-2'>
                <div class='d-flex align-items-center gap-1 mb-1'>
                    <label class='form-label small fw-semibold mb-0'>D4H Personal Access Token</label>
                    <div
                        ref='tokenHelpRef'
                        class='position-relative d-inline-flex'
                    >
                        <button
                            type='button'
                            class='btn btn-link btn-sm p-0 text-muted lh-1 border-0'
                            aria-label='How to obtain a D4H Personal Access Token'
                            @click.stop='tokenHelpOpen = !tokenHelpOpen'
                        >
                            <IconInfoCircle
                                :size='16'
                                stroke='1.5'
                            />
                        </button>
                        <div
                            v-if='tokenHelpOpen'
                            class='position-absolute start-0 mt-1 p-2 bg-body border rounded shadow-sm small'
                            style='z-index:1050; min-width:16rem; top:100%;'
                            @click.stop
                        >
                            <a
                                href='https://api.team-manager.us.d4h.com/v3/docs#section/Introduction/Getting-Authenticated'
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                See D4H Instructions for Obtaining Personal Access Tokens
                            </a>
                        </div>
                    </div>
                </div>
                <input
                    v-model='form.token'
                    type='password'
                    autocomplete='off'
                    class='form-control form-control-sm font-monospace'
                    placeholder='Paste D4H Bearer token'
                    required
                >
                <div class='form-text small'>
                    Stored locally via Capacitor Preferences. On deployed CloudTAK (non-localhost), D4H
                    calls go through the Plugin Proxy — enable it in Admin and whitelist your D4H API
                    origin (e.g. <code>https://api.team-manager.us.d4h.com</code>).
                </div>
            </div>

            <div class='mt-3 d-flex gap-2 flex-wrap align-items-center'>
                <button
                    type='submit'
                    class='btn btn-primary btn-sm'
                    :disabled='!canSubmit || saving'
                >
                    {{ saving ? 'Saving…' : 'Save local' }}
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
                >
                    Clear saved config
                </button>
            </div>
        </form>

        <div
            v-if='status'
            class='alert alert-dismissible fade show alert-sm mt-3 small'
            :class='statusClass'
        >
            <button
                type='button'
                class='btn-close'
                aria-label='Close'
                @click='status = null'
            />
            <div class='fw-semibold'>
                {{ status.title }}
            </div>
            <div
                v-if='status.detail'
                style='white-space:pre-wrap'
            >
                {{ status.detail }}
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { IconInfoCircle } from '@tabler/icons-vue';
import {
    loadConfig, saveConfig, clearConfig, regionBaseUrl,
    type D4HConfig, type D4HRegion, type D4HContext,
} from '../lib/d4h-config.ts';
import { testConnection } from '../lib/d4h-client.ts';
import { getServerConfig, updateServerConfig } from '../lib/d4h-api.ts';
import ProfileConfig from '../../../src/base/profile.ts';

const emit = defineEmits<{ (e: 'saved', config: D4HConfig): void; (e: 'cleared'): void; (e: 'server-saved'): void }>();

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

const serverForm = reactive({
    region:               'us' as D4HRegion,
    baseUrl:              '',
    context:              'team' as D4HContext,
    contextId:            null as number | null,
    token:                '',
    tokenConfigured:      false,
    defaultGroupsText:    '',
    syncIntervalMinutes:  60,
    lastSyncAt:           null as string | null,
    lastSyncStatus:       null as string | null,
    lastSyncError:        null as string | null,
});

const saving         = ref(false);
const serverSaving   = ref(false);
const testing        = ref(false);
const hasSaved       = ref(false);
const isSystemAdmin  = ref(false);
/** null = probing, true = route present, false = 404 / missing */
const serverAvailable = ref<boolean | null>(null);
const status         = ref<{ kind: 'ok' | 'err' | 'info'; title: string; detail?: string } | null>(null);
const tokenHelpOpen  = ref(false);
const tokenHelpRef   = ref<HTMLElement | null>(null);

function onDocumentClick(event: MouseEvent): void {
    if (!tokenHelpOpen.value) return;
    const el = tokenHelpRef.value;
    if (el && !el.contains(event.target as Node)) {
        tokenHelpOpen.value = false;
    }
}

const regionDefaultUrl = computed(() => regionBaseUrl(form.region));
const serverRegionDefaultUrl = computed(() => regionBaseUrl(serverForm.region));
const canSubmit = computed(() =>
    !!form.region && !!form.context && !!form.token && typeof form.contextId === 'number' && form.contextId > 0
);
const canSubmitServer = computed(() =>
    !!serverForm.region
    && !!serverForm.context
    && typeof serverForm.contextId === 'number'
    && serverForm.contextId > 0
    && (serverForm.tokenConfigured || !!serverForm.token.trim())
);
const statusClass = computed(() => ({
    'alert-success': status.value?.kind === 'ok',
    'alert-danger':  status.value?.kind === 'err',
    'alert-info':    status.value?.kind === 'info',
}));

async function loadServerSection(): Promise<void> {
    try {
        const cfg = await getServerConfig();
        if (!cfg) {
            serverAvailable.value = false;
            return;
        }
        serverAvailable.value = true;
        serverForm.region = (cfg.region as D4HRegion) || 'us';
        serverForm.baseUrl = cfg.baseUrl ?? '';
        serverForm.context = (cfg.context as D4HContext) || 'team';
        serverForm.contextId = cfg.contextId ?? null;
        serverForm.tokenConfigured = !!cfg.tokenConfigured;
        serverForm.defaultGroupsText = (cfg.defaultGroups ?? []).join(', ');
        serverForm.syncIntervalMinutes = cfg.syncIntervalMinutes || 60;
        serverForm.lastSyncAt = cfg.lastSyncAt ?? null;
        serverForm.lastSyncStatus = cfg.lastSyncStatus ?? null;
        serverForm.lastSyncError = cfg.lastSyncError ?? null;
        serverForm.token = '';
    } catch (e) {
        // Auth failure still means route exists.
        if (String((e as Error).message) === '401') {
            serverAvailable.value = true;
            return;
        }
        serverAvailable.value = false;
    }
}

onMounted(async () => {
    document.addEventListener('click', onDocumentClick);
    const existing = await loadConfig();
    if (existing) {
        form.region    = existing.region;
        form.baseUrl   = existing.baseUrl ?? '';
        form.context   = existing.context;
        form.contextId = existing.contextId;
        form.token     = existing.token;
        hasSaved.value = true;
    }
    try {
        const adminCfg = await ProfileConfig.get('system_admin');
        isSystemAdmin.value = !!(adminCfg?.value);
    } catch {
        isSystemAdmin.value = false;
    }
    await loadServerSection();
});

onUnmounted(() => {
    document.removeEventListener('click', onDocumentClick);
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

async function onSaveServer(): Promise<void> {
    if (!canSubmitServer.value || serverForm.contextId == null) return;
    serverSaving.value = true;
    try {
        const groups = serverForm.defaultGroupsText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        const body: Parameters<typeof updateServerConfig>[0] = {
            region: serverForm.region,
            baseUrl: serverForm.baseUrl.trim() || null,
            context: serverForm.context,
            contextId: serverForm.contextId,
            defaultGroups: groups,
            syncIntervalMinutes: serverForm.syncIntervalMinutes,
        };
        if (serverForm.token.trim()) body.token = serverForm.token.trim();
        const saved = await updateServerConfig(body);
        serverForm.tokenConfigured = !!saved.tokenConfigured;
        serverForm.token = '';
        serverForm.lastSyncAt = saved.lastSyncAt ?? null;
        serverForm.lastSyncStatus = saved.lastSyncStatus ?? null;
        serverForm.lastSyncError = saved.lastSyncError ?? null;
        status.value = { kind: 'ok', title: 'Server config saved.' };
        emit('server-saved');
    } catch (e) {
        status.value = { kind: 'err', title: 'Server save failed.', detail: (e as Error).message };
    } finally {
        serverSaving.value = false;
    }
}

async function onClearServerToken(): Promise<void> {
    serverSaving.value = true;
    try {
        await updateServerConfig({ clearToken: true });
        serverForm.tokenConfigured = false;
        serverForm.token = '';
        status.value = { kind: 'info', title: 'Server token cleared. Periodic sync stopped until a token is saved again.' };
        emit('server-saved');
    } catch (e) {
        status.value = { kind: 'err', title: 'Could not clear server token.', detail: (e as Error).message };
    } finally {
        serverSaving.value = false;
    }
}

async function onSave(): Promise<void> {
    const cfg = buildConfig();
    if (!cfg) return;
    saving.value = true;
    try {
        await saveConfig(cfg);
        hasSaved.value = true;
        status.value = { kind: 'ok', title: 'Local config saved.' };
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
    status.value   = { kind: 'info', title: 'Cleared saved local config.' };
    emit('cleared');
}
</script>
