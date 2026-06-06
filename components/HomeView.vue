<template>
    <div class='d-flex flex-column h-100 overflow-hidden'>
        <div class='d-flex align-items-center px-3 py-2 border-bottom flex-shrink-0 gap-2'>
            <D4HIcon :size='22' />
            <span class='fw-semibold'>D4H</span>
            <span class='text-muted ms-auto small'>
                {{ loaded ? (hasConfig ? statusBadge : 'Not configured') : 'Loading…' }}
            </span>
        </div>

        <!-- Config UI when nothing saved -->
        <ConfigView
            v-if='loaded && !hasConfig'
            @saved='onConfigSaved'
        />

        <!-- Roster pane -->
        <div v-else-if='loaded && hasConfig' class='flex-grow-1 overflow-auto p-3'>
            <div class='d-flex align-items-center gap-2 flex-wrap mb-3'>
                <button
                    class='btn btn-primary btn-sm'
                    :disabled='syncing'
                    @click='onSync'
                >
                    <span v-if='syncing' class='spinner-border spinner-border-sm me-1' />
                    {{ syncing ? 'Syncing…' : 'Sync now' }}
                </button>
                <span v-if='meta' class='text-muted small'>
                    Last sync: <span :title='meta.fetchedAt'>{{ relativeFetchedAt }}</span> ·
                    {{ meta.memberCount }} member{{ meta.memberCount === 1 ? '' : 's' }}
                    <span v-if='meta.equipmentCount > 0'>
                        · {{ meta.equipmentCount }} equipment item{{ meta.equipmentCount === 1 ? '' : 's' }}
                    </span>
                </span>
                <span v-else class='text-muted small'>No sync yet.</span>

                <button
                    class='btn btn-outline-secondary btn-sm ms-auto'
                    @click='showConfig = !showConfig'
                >
                    {{ showConfig ? 'Hide config' : 'Edit config' }}
                </button>
            </div>

            <div
                v-if='syncStatus'
                class='alert small'
                :class='syncStatus.kind === "ok" ? "alert-success" : syncStatus.kind === "err" ? "alert-danger" : "alert-info"'
            >
                <div class='fw-semibold'>{{ syncStatus.title }}</div>
                <div v-if='syncStatus.detail' style='white-space:pre-wrap'>{{ syncStatus.detail }}</div>
            </div>

            <div v-if='meta?.warnings?.length' class='alert alert-warning small'>
                <div class='fw-semibold mb-1'>Sync warnings ({{ meta.warnings.length }})</div>
                <ul class='mb-0 ps-3'>
                    <li v-for='(w, i) in meta.warnings' :key='i'>{{ w }}</li>
                </ul>
            </div>

            <!-- Member preview -->
            <div v-if='roster?.members?.length' class='card mb-3'>
                <div class='card-header py-1 px-2 d-flex align-items-center gap-2 flex-wrap'>
                    <span class='small fw-semibold'>
                        Members ({{ filteredMembers.length }}<span v-if='filteredMembers.length !== roster.members.length' class='text-muted fw-normal'> of {{ roster.members.length }}</span>)
                    </span>
                    <input
                        v-model='filter'
                        type='search'
                        class='form-control form-control-sm ms-auto'
                        style='max-width:240px'
                        placeholder='Filter by name, badge, position, mobile…'
                    />
                </div>
                <div class='table-responsive' style='max-height:50vh;overflow:auto'>
                    <table class='table table-sm table-hover mb-0 small'>
                        <thead class='sticky-top bg-body'>
                            <tr>
                                <th
                                    style='width:72px;cursor:pointer;user-select:none'
                                    @click='toggleSort("badge")'
                                >
                                    Badge
                                    <span v-if='sortBy === "badge"' class='text-muted ms-1'>{{ sortDir === "asc" ? "▲" : "▼" }}</span>
                                </th>
                                <th
                                    style='cursor:pointer;user-select:none'
                                    @click='toggleSort("name")'
                                >
                                    Name
                                    <span v-if='sortBy === "name"' class='text-muted ms-1'>{{ sortDir === "asc" ? "▲" : "▼" }}</span>
                                </th>
                                <th>Position</th>
                                <th style='width:150px'>Mobile</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for='m in sortedMembers' :key='m.id'>
                                <td class='font-monospace'>{{ m.ref ?? '—' }}</td>
                                <td>{{ m.name }}</td>
                                <td class='text-muted'>{{ m.position ?? '' }}</td>
                                <td class='font-monospace'>{{ m.mobile ?? '—' }}</td>
                            </tr>
                            <tr v-if='sortedMembers.length === 0'>
                                <td colspan='4' class='text-center text-muted py-3'>
                                    No members match the filter.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Equipment preview (vehicles / UAS / tech litter only) -->
            <div v-if='roster && (roster.equipment.length || meta?.equipmentCategories?.length)' class='card mb-3'>
                <div class='card-header py-1 px-2 d-flex align-items-center gap-2 flex-wrap'>
                    <span class='small fw-semibold'>
                        Equipment ({{ filteredEquipment.length }}<span v-if='filteredEquipment.length !== roster.equipment.length' class='text-muted fw-normal'> of {{ roster.equipment.length }}</span>)
                    </span>
                    <input
                        v-model='equipFilter'
                        type='search'
                        class='form-control form-control-sm ms-auto'
                        style='max-width:240px'
                        placeholder='Filter by name, badge, category…'
                    />
                </div>

                <!-- Discovered categories — green = kept by the vehicles/UAS/tech-litter filter.
                     If the ones you want aren't green, the label differs; tweak
                     WANTED_CATEGORY_KEYWORDS in lib/d4h-equipment-categories.ts. -->
                <div
                    v-if='meta?.equipmentCategories?.length'
                    class='px-2 py-1 small border-bottom d-flex flex-wrap gap-1 align-items-center'
                >
                    <span class='text-muted me-1'>Categories found:</span>
                    <span
                        v-for='c in meta.equipmentCategories'
                        :key='c.title'
                        class='badge'
                        :class='c.included ? "bg-success" : "bg-light text-muted border"'
                        :title='c.included ? "Kept by the vehicles / UAS / tech-litter filter" : "Not in the wanted categories"'
                    >{{ c.title }} ({{ c.count }})</span>
                </div>
                <div class='table-responsive' style='max-height:50vh;overflow:auto'>
                    <table class='table table-sm table-hover mb-0 small'>
                        <thead class='sticky-top bg-body'>
                            <tr>
                                <th
                                    style='width:72px;cursor:pointer;user-select:none'
                                    @click='toggleEquipSort("badge")'
                                >
                                    Badge
                                    <span v-if='equipSortBy === "badge"' class='text-muted ms-1'>{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                </th>
                                <th
                                    style='cursor:pointer;user-select:none'
                                    @click='toggleEquipSort("name")'
                                >
                                    Name
                                    <span v-if='equipSortBy === "name"' class='text-muted ms-1'>{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                </th>
                                <th
                                    style='width:160px;cursor:pointer;user-select:none'
                                    @click='toggleEquipSort("category")'
                                >
                                    Category
                                    <span v-if='equipSortBy === "category"' class='text-muted ms-1'>{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for='e in sortedEquipment' :key='e.id'>
                                <td class='font-monospace'>{{ e.ref ?? '—' }}</td>
                                <td>{{ e.name }}</td>
                                <td class='text-muted'>{{ e.category ?? '—' }}</td>
                            </tr>
                            <tr v-if='sortedEquipment.length === 0'>
                                <td colspan='3' class='text-center text-muted py-3'>
                                    {{ equipFilter ? 'No equipment matches the filter.' : 'No equipment in the wanted categories — see "Categories found" above.' }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div v-if='showConfig' class='border-top pt-3'>
                <ConfigView
                    @saved='onConfigSaved'
                    @cleared='onConfigCleared'
                />
            </div>
        </div>

        <div v-else class='flex-grow-1 d-flex align-items-center justify-content-center text-muted small'>
            Loading…
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ConfigView from './ConfigView.vue';
import D4HIcon from '../lib/D4HIcon.vue';
import { loadConfig, effectiveBaseUrl, type D4HConfig } from '../lib/d4h-config.ts';
import { syncNow, loadCachedRoster, loadCachedMeta, liveMeta } from '../lib/d4h-roster.ts';
import type { D4HRoster, D4HRosterMeta } from '../lib/d4h-types.ts';

const loaded     = ref(false);
const config     = ref<D4HConfig | null>(null);
const roster     = ref<D4HRoster | null>(null);
const meta       = ref<D4HRosterMeta | null>(null);
const syncing    = ref(false);
const showConfig = ref(false);
const filter     = ref('');
const sortBy     = ref<'badge' | 'name'>('name');
const sortDir    = ref<'asc' | 'desc'>('asc');
const equipFilter  = ref('');
const equipSortBy  = ref<'badge' | 'name' | 'category'>('name');
const equipSortDir = ref<'asc' | 'desc'>('asc');
const syncStatus = ref<{ kind: 'ok' | 'err' | 'info'; title: string; detail?: string } | null>(null);

const hasConfig = computed(() => !!config.value);

const statusBadge = computed(() => {
    if (!meta.value) return 'Not synced';
    const m = meta.value;
    return `${m.context}/${m.contextId} · ${m.memberCount} members`;
});

const relativeFetchedAt = computed(() => {
    if (!meta.value) return '';
    const ms = Date.now() - new Date(meta.value.fetchedAt).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return new Date(meta.value.fetchedAt).toLocaleDateString();
});

const filteredMembers = computed(() => {
    if (!roster.value) return [];
    const q = filter.value.trim().toLowerCase();
    return roster.value.members.filter(m => {
        if (!q) return true;
        return m.name.toLowerCase().includes(q)
            || (m.ref && m.ref.toLowerCase().includes(q))
            || (m.position && m.position.toLowerCase().includes(q))
            || (m.mobile && m.mobile.toLowerCase().includes(q));
    });
});

const sortedMembers = computed(() => {
    const dir = sortDir.value === 'asc' ? 1 : -1;
    return [...filteredMembers.value].sort((a, b) => {
        if (sortBy.value === 'badge') {
            const av = (a.ref ?? '').toLowerCase();
            const bv = (b.ref ?? '').toLowerCase();
            return av.localeCompare(bv, undefined, { numeric: true }) * dir;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
    });
});

function toggleSort(key: 'badge' | 'name'): void {
    if (sortBy.value === key) {
        sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortBy.value  = key;
        sortDir.value = 'asc';
    }
}

const filteredEquipment = computed(() => {
    if (!roster.value) return [];
    const q = equipFilter.value.trim().toLowerCase();
    return roster.value.equipment.filter(e => {
        if (!q) return true;
        return e.name.toLowerCase().includes(q)
            || (e.ref && e.ref.toLowerCase().includes(q))
            || (e.category && e.category.toLowerCase().includes(q));
    });
});

const sortedEquipment = computed(() => {
    const dir = equipSortDir.value === 'asc' ? 1 : -1;
    const key = equipSortBy.value;
    return [...filteredEquipment.value].sort((a, b) => {
        if (key === 'badge') {
            return (a.ref ?? '').toLowerCase().localeCompare((b.ref ?? '').toLowerCase(), undefined, { numeric: true }) * dir;
        }
        if (key === 'category') {
            return (a.category ?? '').toLowerCase().localeCompare((b.category ?? '').toLowerCase()) * dir;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
    });
});

function toggleEquipSort(key: 'badge' | 'name' | 'category'): void {
    if (equipSortBy.value === key) {
        equipSortDir.value = equipSortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        equipSortBy.value  = key;
        equipSortDir.value = 'asc';
    }
}

let metaSub: { unsubscribe: () => void } | null = null;

onMounted(async () => {
    config.value = await loadConfig();
    roster.value = await loadCachedRoster();
    meta.value   = await loadCachedMeta();
    loaded.value = true;

    metaSub = liveMeta().subscribe({
        next: (m) => { meta.value = m; },
    });
});

onUnmounted(() => {
    metaSub?.unsubscribe();
});

function statsLine(label: string, s: { pages: number; rawCount: number; reportedTotal: number | null }): string {
    const total = s.reportedTotal != null ? ` of ${s.reportedTotal} reported` : '';
    return `${label}: ${s.rawCount}${total} across ${s.pages} page${s.pages === 1 ? '' : 's'}`;
}

async function onSync(): Promise<void> {
    if (!config.value) return;
    syncing.value = true;
    syncStatus.value = { kind: 'info', title: 'Syncing roster from D4H…' };
    try {
        const result = await syncNow(config.value);
        if (result.ok && result.roster) {
            roster.value = result.roster;
            meta.value   = result.roster.meta;
            const warnCount = result.warnings.length;
            const cats = result.roster.meta.equipmentCategories ?? [];
            const kept = cats.filter(c => c.included);
            const detail = [
                statsLine('Members', result.stats.members),
                statsLine('Equipment', result.stats.equipment),
                kept.length
                    ? `Equipment kept: ${kept.map(c => `${c.title} (${c.count})`).join(', ')}`
                    : (cats.length ? `Equipment kept: none of ${cats.length} categories matched` : ''),
                statsLine('Qualifications', result.stats.qualifications),
                warnCount ? `${warnCount} warning${warnCount === 1 ? '' : 's'} — see below.` : '',
            ].filter(Boolean).join('\n');
            syncStatus.value = {
                kind:  'ok',
                title: `Synced ${result.roster.meta.memberCount} member${result.roster.meta.memberCount === 1 ? '' : 's'}.`,
                detail,
            };
        } else {
            syncStatus.value = { kind: 'err', title: 'Sync failed.', detail: result.error };
        }
    } catch (e) {
        syncStatus.value = { kind: 'err', title: 'Sync threw.', detail: (e as Error).message };
    } finally {
        syncing.value = false;
    }
}

function onConfigSaved(cfg: D4HConfig): void {
    config.value     = cfg;
    showConfig.value = false;
    syncStatus.value = {
        kind:   'info',
        title:  'Config saved.',
        detail: `Target: ${effectiveBaseUrl(cfg)} (${cfg.context}/${cfg.contextId}). Click "Sync now" to pull the roster.`,
    };
}

function onConfigCleared(): void {
    config.value = null;
    roster.value = null;
    meta.value   = null;
}
</script>
