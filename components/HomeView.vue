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
        <div
            v-else-if='loaded && hasConfig'
            class='flex-grow-1 overflow-auto p-3'
        >
            <div class='d-flex align-items-center gap-2 flex-wrap mb-3'>
                <button
                    class='btn btn-primary btn-sm'
                    :disabled='syncing'
                    @click='onSync'
                >
                    <span
                        v-if='syncing'
                        class='spinner-border spinner-border-sm me-1'
                    />
                    {{ syncing ? 'Syncing…' : 'Sync now' }}
                </button>
                <span
                    v-if='meta'
                    class='text-muted small'
                >
                    Last sync: <span :title='meta.fetchedAt'>{{ relativeFetchedAt }}</span> ·
                    {{ meta.memberCount }} member{{ meta.memberCount === 1 ? '' : 's' }}
                    <span v-if='meta.equipmentCount > 0'>
                        · {{ meta.equipmentCount }} equipment item{{ meta.equipmentCount === 1 ? '' : 's' }}
                    </span>
                    <span v-if='(meta.externalResourceCount ?? 0) > 0'>
                        · {{ meta.externalResourceCount }} resource{{ meta.externalResourceCount === 1 ? '' : 's' }}
                    </span>
                    <span v-if='(meta.incidentCount ?? 0) > 0'>
                        · {{ meta.incidentCount }} incident{{ meta.incidentCount === 1 ? '' : 's' }}
                    </span>
                </span>
                <span
                    v-else
                    class='text-muted small'
                >No sync yet.</span>

                <button
                    class='btn btn-outline-secondary btn-sm ms-auto'
                    @click='showConfig = !showConfig'
                >
                    {{ showConfig ? 'Hide config' : 'Edit config' }}
                </button>
            </div>

            <div
                v-if='syncStatus'
                class='alert alert-dismissible fade show small'
                :class='syncStatus.kind === "ok" ? "alert-success" : syncStatus.kind === "err" ? "alert-danger" : "alert-info"'
            >
                <button
                    type='button'
                    class='btn-close'
                    aria-label='Close'
                    @click='syncStatus = null'
                />
                <div class='fw-semibold'>
                    {{ syncStatus.title }}
                </div>
                <div
                    v-if='syncStatus.detail'
                    style='white-space:pre-wrap'
                >
                    {{ syncStatus.detail }}
                </div>
            </div>

            <div
                v-if='meta?.warnings?.length && !warningsDismissed'
                class='alert alert-warning alert-dismissible fade show small'
            >
                <button
                    type='button'
                    class='btn-close'
                    aria-label='Close'
                    @click='warningsDismissed = true'
                />
                <div class='fw-semibold mb-1'>
                    Sync warnings ({{ meta.warnings.length }})
                </div>
                <ul class='mb-0 ps-3'>
                    <li
                        v-for='(w, i) in meta.warnings'
                        :key='i'
                    >
                        {{ w }}
                    </li>
                </ul>
            </div>

            <div
                class='d-flex border-bottom flex-shrink-0'
                :class='activeMainTab === "incidents" ? "mb-3" : "mb-0"'
            >
                <button
                    v-for='tab in mainTabs'
                    :key='tab.key'
                    type='button'
                    class='flex-fill btn btn-sm rounded-0 py-2 border-0'
                    :class='activeMainTab === tab.key ? "bg-primary text-white fw-semibold" : "text-muted"'
                    @click='activeMainTab = tab.key'
                >
                    {{ tab.label }}
                </button>
            </div>

            <div
                v-if='activeMainTab === "resources"'
                class='d-flex flex-wrap gap-1 mb-3 mt-2 flex-shrink-0'
            >
                <button
                    v-for='tab in resourcesSubTabs'
                    :key='tab.key'
                    type='button'
                    class='btn btn-sm btn-outline-warning'
                    :class='{ active: resourcesSubTab === tab.key }'
                    @click='resourcesSubTab = tab.key'
                >
                    {{ tab.label }}
                </button>
            </div>

            <div
                v-else-if='activeMainTab === "submit-d4h"'
                class='d-flex flex-wrap gap-1 mb-3 mt-2 flex-shrink-0'
            >
                <button
                    v-for='tab in submitSubTabs'
                    :key='tab.key'
                    type='button'
                    class='btn btn-sm btn-outline-warning'
                    :class='{ active: submitSubTab === tab.key }'
                    @click='submitSubTab = tab.key'
                >
                    {{ tab.label }}
                </button>
            </div>

            <!-- Personnel -->
            <div v-if='activeContentKey === "personnel"'>
                <div
                    v-if='roster?.members?.length'
                    class='card mb-3'
                >
                    <div class='card-header py-1 px-2 d-flex align-items-center gap-2 flex-wrap'>
                        <span class='small fw-semibold'>
                            Personnel ({{ filteredMembers.length }}<span
                                v-if='filteredMembers.length !== roster.members.length'
                                class='text-muted fw-normal'
                            > of {{ roster.members.length }}</span>)
                        </span>
                        <input
                            v-model='filter'
                            type='search'
                            class='form-control form-control-sm ms-auto'
                            style='max-width:240px'
                            placeholder='Filter by name, badge, position, mobile…'
                        >
                    </div>
                    <div
                        class='table-responsive'
                        style='max-height:50vh;overflow:auto'
                    >
                        <table class='table table-sm table-hover mb-0 small'>
                            <thead class='sticky-top bg-body'>
                                <tr>
                                    <th
                                        style='width:72px;cursor:pointer;user-select:none'
                                        @click='toggleSort("badge")'
                                    >
                                        Badge
                                        <span
                                            v-if='sortBy === "badge"'
                                            class='text-muted ms-1'
                                        >{{ sortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='cursor:pointer;user-select:none'
                                        @click='toggleSort("name")'
                                    >
                                        Name
                                        <span
                                            v-if='sortBy === "name"'
                                            class='text-muted ms-1'
                                        >{{ sortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th>Position</th>
                                    <th style='width:150px'>
                                        Mobile
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for='m in sortedMembers'
                                    :key='m.id'
                                    style='cursor:default'
                                    @mouseenter='showQuals(m, $event)'
                                    @mouseleave='hideQuals'
                                >
                                    <td class='font-monospace'>
                                        {{ m.ref ?? '—' }}
                                    </td>
                                    <td>
                                        {{ m.name }}
                                        <span
                                            v-if='m.qualifications?.length'
                                            class='badge bg-success text-white ms-1'
                                            style='font-size:0.65em;vertical-align:middle'
                                            :title='m.qualifications.length + " qualification(s) — hover to view"'
                                        >{{ m.qualifications.length }}</span>
                                    </td>
                                    <td class='text-muted'>
                                        {{ m.position ?? '' }}
                                    </td>
                                    <td class='font-monospace'>
                                        {{ m.mobile ?? '—' }}
                                    </td>
                                </tr>
                                <tr v-if='sortedMembers.length === 0'>
                                    <td
                                        colspan='4'
                                        class='text-center text-muted py-3'
                                    >
                                        No members match the filter.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div
                    v-else
                    class='text-muted small text-center py-4'
                >
                    No personnel synced yet.
                </div>

                <!-- Hover popup: qualifications for the member row under the cursor.
                     position:fixed escapes the table's scroll clipping; pointer-events:none
                     means moving toward it counts as leaving the row, so it dismisses. -->
                <div
                    v-if='hoverQuals'
                    class='card shadow'
                    :style='{
                        position: "fixed",
                        left: hoverQuals.x + "px",
                        top: hoverQuals.y + "px",
                        zIndex: 1080,
                        width: "300px",
                        maxHeight: "260px",
                        overflow: "auto",
                        pointerEvents: "none",
                    }'
                >
                    <div class='card-header py-1 px-2 small fw-semibold'>
                        {{ hoverQuals.member.name }}
                    </div>
                    <div class='card-body py-2 px-2'>
                        <div
                            v-if='hoverQuals.member.qualifications?.length'
                            class='d-flex flex-wrap gap-1'
                        >
                            <span
                                v-for='q in hoverQuals.member.qualifications'
                                :key='q.id'
                                class='badge'
                                :class='isExpired(q) ? "bg-secondary text-white text-decoration-line-through" : "bg-success text-white"'
                                :title='q.expiresAt ? ((isExpired(q) ? "Expired " : "Expires ") + q.expiresAt.slice(0, 10)) : "No expiry on record"'
                            >{{ q.name }}</span>
                        </div>
                        <span
                            v-else
                            class='text-muted small'
                        >No qualifications on record.</span>
                    </div>
                </div>
            </div>

            <!-- Equipment -->
            <div v-else-if='activeContentKey === "equipment"'>
                <div
                    v-if='roster?.equipment?.length || meta?.equipmentCategories?.length'
                    class='card mb-3'
                >
                    <div class='card-header py-1 px-2 d-flex align-items-center gap-2 flex-wrap'>
                        <span class='small fw-semibold'>
                            Equipment ({{ filteredEquipment.length }}<span
                                v-if='filteredEquipment.length !== (roster?.equipment?.length ?? 0)'
                                class='text-muted fw-normal'
                            > of {{ roster?.equipment?.length ?? 0 }}</span>)
                        </span>
                        <input
                            v-model='equipFilter'
                            type='search'
                            class='form-control form-control-sm ms-auto'
                            style='max-width:240px'
                            placeholder='Filter by id, type, make, model, category…'
                        >
                    </div>

                        <div
                            v-if='meta?.equipmentCategories?.length'
                            class='px-2 py-1 small border-bottom d-flex flex-wrap gap-1 align-items-center'
                        >
                            <span class='text-muted me-1'>Categories found:</span>
                            <span
                                v-for='c in meta.equipmentCategories'
                                :key='c.title'
                                class='badge'
                                :class='c.included ? "bg-success text-white" : "bg-secondary text-white text-decoration-line-through"'
                                :title='c.included ? "Kept by the vehicles / UAS / tech-litter filter" : "Not in the wanted categories"'
                            >{{ c.title }} ({{ c.count }})</span>
                        </div>
                    <div
                        class='table-responsive'
                        style='max-height:50vh;overflow:auto'
                    >
                        <table class='table table-sm table-hover mb-0 small'>
                            <thead class='sticky-top bg-body'>
                                <tr>
                                    <th
                                        style='width:72px;cursor:pointer;user-select:none'
                                        @click='toggleEquipSort("ref")'
                                    >
                                        ID
                                        <span
                                            v-if='equipSortBy === "ref"'
                                            class='text-muted ms-1'
                                        >{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='cursor:pointer;user-select:none'
                                        @click='toggleEquipSort("type")'
                                    >
                                        Type
                                        <span
                                            v-if='equipSortBy === "type"'
                                            class='text-muted ms-1'
                                        >{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='cursor:pointer;user-select:none'
                                        @click='toggleEquipSort("make")'
                                    >
                                        Make
                                        <span
                                            v-if='equipSortBy === "make"'
                                            class='text-muted ms-1'
                                        >{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='cursor:pointer;user-select:none'
                                        @click='toggleEquipSort("model")'
                                    >
                                        Model
                                        <span
                                            v-if='equipSortBy === "model"'
                                            class='text-muted ms-1'
                                        >{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='width:160px;cursor:pointer;user-select:none'
                                        @click='toggleEquipSort("category")'
                                    >
                                        Category
                                        <span
                                            v-if='equipSortBy === "category"'
                                            class='text-muted ms-1'
                                        >{{ equipSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for='e in sortedEquipment'
                                    :key='e.id'
                                >
                                    <td class='font-monospace'>
                                        {{ e.ref ?? '—' }}
                                    </td>
                                    <td>{{ e.name }}</td>
                                    <td class='text-muted'>
                                        {{ e.make ?? '—' }}
                                    </td>
                                    <td class='text-muted'>
                                        {{ e.model ?? '—' }}
                                    </td>
                                    <td class='text-muted'>
                                        {{ e.category ?? '—' }}
                                    </td>
                                </tr>
                                <tr v-if='sortedEquipment.length === 0'>
                                    <td
                                        colspan='5'
                                        class='text-center text-muted py-3'
                                    >
                                        {{ equipFilter ? 'No equipment matches the filter.' : 'No operational equipment in the wanted categories — see "Categories found" above.' }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div
                    v-else
                    class='text-muted small text-center py-4'
                >
                    No operational equipment in the wanted categories — sync to discover categories.
                </div>
            </div>

            <!-- External resources (Intelligence → Resources) -->
            <div v-else-if='activeContentKey === "resources"'>
                <div
                    v-if='roster?.externalResources?.length'
                    class='card mb-3'
                >
                    <div class='card-header py-1 px-2 d-flex align-items-center gap-2 flex-wrap'>
                        <span class='small fw-semibold'>
                            External resources ({{ filteredExternalResources.length }}<span
                                v-if='filteredExternalResources.length !== (roster?.externalResources?.length ?? 0)'
                                class='text-muted fw-normal'
                            > of {{ roster?.externalResources?.length ?? 0 }}</span>)
                        </span>
                        <input
                            v-model='resourceFilter'
                            type='search'
                            class='form-control form-control-sm ms-auto'
                            style='max-width:240px'
                            placeholder='Filter by id or agency name…'
                        >
                    </div>
                    <div
                        class='table-responsive'
                        style='max-height:50vh;overflow:auto'
                    >
                        <table class='table table-sm table-hover mb-0 small'>
                            <thead class='sticky-top bg-body'>
                                <tr>
                                    <th
                                        style='width:88px;cursor:pointer;user-select:none'
                                        @click='toggleResourceSort("id")'
                                    >
                                        ID
                                        <span
                                            v-if='resourceSortBy === "id"'
                                            class='text-muted ms-1'
                                        >{{ resourceSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='cursor:pointer;user-select:none'
                                        @click='toggleResourceSort("name")'
                                    >
                                        Agency
                                        <span
                                            v-if='resourceSortBy === "name"'
                                            class='text-muted ms-1'
                                        >{{ resourceSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for='r in sortedExternalResources'
                                    :key='r.id'
                                >
                                    <td class='font-monospace'>
                                        {{ r.id }}
                                    </td>
                                    <td>{{ r.name }}</td>
                                </tr>
                                <tr v-if='sortedExternalResources.length === 0'>
                                    <td
                                        colspan='2'
                                        class='text-center text-muted py-3'
                                    >
                                        No resources match the filter.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div
                    v-else
                    class='text-muted small text-center py-4'
                >
                    No external resources synced yet — run Sync now (uses D4H search API).
                </div>
            </div>

            <!-- Incidents (last 30 days) -->
            <div v-else-if='activeContentKey === "incidents"'>
                <div
                    v-if='roster?.incidents?.length'
                    class='card mb-3'
                >
                    <div class='card-header py-1 px-2 d-flex align-items-center gap-2 flex-wrap'>
                        <span class='small fw-semibold'>
                            Incidents — last 30 days ({{ filteredIncidents.length }}<span
                                v-if='filteredIncidents.length !== (roster?.incidents?.length ?? 0)'
                                class='text-muted fw-normal'
                            > of {{ roster?.incidents?.length ?? 0 }}</span>)
                        </span>
                        <input
                            v-model='incidentFilter'
                            type='search'
                            class='form-control form-control-sm ms-auto'
                            style='max-width:280px'
                            placeholder='Filter by ref, title, tracking #…'
                        >
                    </div>
                    <div
                        class='table-responsive'
                        style='max-height:50vh;overflow:auto'
                    >
                        <table class='table table-sm table-hover mb-0 small'>
                            <thead class='sticky-top bg-body'>
                                <tr>
                                    <th
                                        style='width:72px;cursor:pointer;user-select:none'
                                        @click='toggleIncidentSort("reference")'
                                    >
                                        Ref
                                        <span
                                            v-if='incidentSortBy === "reference"'
                                            class='text-muted ms-1'
                                        >{{ incidentSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='cursor:pointer;user-select:none'
                                        @click='toggleIncidentSort("title")'
                                    >
                                        Title
                                        <span
                                            v-if='incidentSortBy === "title"'
                                            class='text-muted ms-1'
                                        >{{ incidentSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='width:100px;cursor:pointer;user-select:none'
                                        @click='toggleIncidentSort("startsAt")'
                                    >
                                        Started
                                        <span
                                            v-if='incidentSortBy === "startsAt"'
                                            class='text-muted ms-1'
                                        >{{ incidentSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='width:100px;cursor:pointer;user-select:none'
                                        @click='toggleIncidentSort("endsAt")'
                                    >
                                        Ended
                                        <span
                                            v-if='incidentSortBy === "endsAt"'
                                            class='text-muted ms-1'
                                        >{{ incidentSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th
                                        style='width:88px;cursor:pointer;user-select:none'
                                        @click='toggleIncidentSort("trackingNumber")'
                                    >
                                        Tracking #
                                        <span
                                            v-if='incidentSortBy === "trackingNumber"'
                                            class='text-muted ms-1'
                                        >{{ incidentSortDir === "asc" ? "▲" : "▼" }}</span>
                                    </th>
                                    <th style='width:56px'>
                                        Pub.
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for='inc in sortedIncidents'
                                    :key='inc.id'
                                    :title='inc.description || undefined'
                                >
                                    <td class='font-monospace'>
                                        {{ inc.reference ?? inc.id }}
                                    </td>
                                    <td>{{ inc.title }}</td>
                                    <td class='text-nowrap'>
                                        {{ formatIncidentDate(inc.startsAt) }}
                                    </td>
                                    <td class='text-nowrap'>
                                        {{ formatIncidentDate(inc.endsAt) || '—' }}
                                    </td>
                                    <td class='font-monospace'>
                                        {{ inc.trackingNumber ?? '—' }}
                                    </td>
                                    <td>
                                        <span
                                            v-if='inc.published === true'
                                            class='badge bg-success'
                                        >Yes</span>
                                        <span
                                            v-else-if='inc.published === false'
                                            class='badge bg-secondary'
                                        >No</span>
                                        <span
                                            v-else
                                            class='text-muted'
                                        >—</span>
                                    </td>
                                </tr>
                                <tr v-if='sortedIncidents.length === 0'>
                                    <td
                                        colspan='6'
                                        class='text-center text-muted py-3'
                                    >
                                        No incidents match the filter.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div
                    v-else
                    class='text-muted small text-center py-4'
                >
                    No incidents in the last 30 days — run Sync now.
                </div>
            </div>

            <!-- Submit incident -->
            <div v-else-if='activeContentKey === "submit"'>
                <SubmitIncidentView @incident-created='onIncidentCreated' />
            </div>

            <!-- Submit roster -->
            <div v-else-if='activeContentKey === "submit-roster"'>
                <SubmitRosterView :roster='roster' />
            </div>

            <!-- Submit subject -->
            <div v-else-if='activeContentKey === "submit-subject"'>
                <SubmitSubjectView :roster='roster' />
            </div>

            <div
                v-if='showConfig'
                class='border-top pt-3'
            >
                <ConfigView
                    @saved='onConfigSaved'
                    @cleared='onConfigCleared'
                />
            </div>
        </div>

        <div
            v-else
            class='flex-grow-1 d-flex align-items-center justify-content-center text-muted small'
        >
            Loading…
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ConfigView from './ConfigView.vue';
import SubmitIncidentView from './SubmitIncidentView.vue';
import SubmitRosterView from './SubmitRosterView.vue';
import SubmitSubjectView from './SubmitSubjectView.vue';
import D4HIcon from '../lib/D4HIcon.vue';
import { loadConfig, effectiveBaseUrl, type D4HConfig } from '../lib/d4h-config.ts';
import { syncNow, loadCachedRoster, loadCachedMeta, liveMeta } from '../lib/d4h-roster.ts';
import type { D4HRoster, D4HRosterMeta, D4HMember } from '../lib/d4h-types.ts';

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
const equipSortBy  = ref<'ref' | 'type' | 'make' | 'model' | 'category'>('type');
const equipSortDir = ref<'asc' | 'desc'>('asc');
const resourceFilter  = ref('');
const resourceSortBy  = ref<'id' | 'name'>('name');
const resourceSortDir = ref<'asc' | 'desc'>('asc');
const incidentFilter  = ref('');
const incidentSortBy  = ref<'reference' | 'title' | 'startsAt' | 'endsAt' | 'trackingNumber'>('startsAt');
const incidentSortDir = ref<'asc' | 'desc'>('desc');
const syncStatus = ref<{ kind: 'ok' | 'err' | 'info'; title: string; detail?: string } | null>(null);
const warningsDismissed = ref(false);

type MainTabKey = 'resources' | 'incidents' | 'submit-d4h';
type ResourcesSubKey = 'personnel' | 'equipment' | 'resources';
type SubmitSubKey = 'submit' | 'submit-roster' | 'submit-subject';
type ContentTabKey = ResourcesSubKey | 'incidents' | SubmitSubKey;

const activeMainTab = ref<MainTabKey>('resources');
const resourcesSubTab = ref<ResourcesSubKey>('personnel');
const submitSubTab = ref<SubmitSubKey>('submit');

const activeContentKey = computed<ContentTabKey>(() => {
    if (activeMainTab.value === 'incidents') return 'incidents';
    if (activeMainTab.value === 'resources') return resourcesSubTab.value;
    return submitSubTab.value;
});

const mainTabs = computed(() => [
    { key: 'resources' as const, label: 'Resources' },
    { key: 'incidents' as const, label: 'Incidents' },
    { key: 'submit-d4h' as const, label: 'Submit to D4H' },
]);

const resourcesSubTabs = computed(() => [
    {
        key:   'personnel' as const,
        label: `Personnel (${meta.value?.memberCount ?? roster.value?.members.length ?? 0})`,
    },
    {
        key:   'equipment' as const,
        label: `Equipment (${meta.value?.equipmentCount ?? roster.value?.equipment.length ?? 0})`,
    },
    {
        key:   'resources' as const,
        label: `Resources (${meta.value?.externalResourceCount ?? roster.value?.externalResources?.length ?? 0})`,
    },
]);

const submitSubTabs = computed(() => [
    { key: 'submit' as const, label: 'Submit Incident' },
    { key: 'submit-roster' as const, label: 'Submit Roster' },
    { key: 'submit-subject' as const, label: 'Submit Subject' },
]);

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

/** A qualification award whose end date is in the past is shown as expired. */
function isExpired(q: { expiresAt?: string }): boolean {
    return !!q.expiresAt && new Date(q.expiresAt).getTime() < Date.now();
}

// Hover popup of a member's qualifications, positioned next to the hovered row.
const hoverQuals = ref<{ member: D4HMember; x: number; y: number } | null>(null);

function showQuals(m: D4HMember, e: MouseEvent): void {
    const el = e.currentTarget as HTMLElement | null;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const PANEL_W = 300;
    hoverQuals.value = {
        member: m,
        // Prefer just to the right of the row; clamp so it stays on screen.
        x: Math.min(rect.right + 8, window.innerWidth - PANEL_W - 8),
        y: Math.max(8, Math.min(rect.top, window.innerHeight - 268)),
    };
}

function hideQuals(): void {
    hoverQuals.value = null;
}

const filteredEquipment = computed(() => {
    if (!roster.value?.equipment) return [];
    const q = equipFilter.value.trim().toLowerCase();
    return roster.value.equipment.filter(e => {
        if (!q) return true;
        return (e.ref && e.ref.toLowerCase().includes(q))
            || e.name.toLowerCase().includes(q)
            || (e.make && e.make.toLowerCase().includes(q))
            || (e.model && e.model.toLowerCase().includes(q))
            || (e.category && e.category.toLowerCase().includes(q));
    });
});

const sortedEquipment = computed(() => {
    const dir = equipSortDir.value === 'asc' ? 1 : -1;
    const key = equipSortBy.value;
    return [...filteredEquipment.value].sort((a, b) => {
        if (key === 'ref') {
            return (a.ref ?? '').toLowerCase().localeCompare((b.ref ?? '').toLowerCase(), undefined, { numeric: true }) * dir;
        }
        if (key === 'category') {
            return (a.category ?? '').toLowerCase().localeCompare((b.category ?? '').toLowerCase()) * dir;
        }
        if (key === 'make') {
            return (a.make ?? '').toLowerCase().localeCompare((b.make ?? '').toLowerCase()) * dir;
        }
        if (key === 'model') {
            return (a.model ?? '').toLowerCase().localeCompare((b.model ?? '').toLowerCase()) * dir;
        }
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) * dir;
    });
});

function toggleEquipSort(key: 'ref' | 'type' | 'make' | 'model' | 'category'): void {
    if (equipSortBy.value === key) {
        equipSortDir.value = equipSortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        equipSortBy.value  = key;
        equipSortDir.value = 'asc';
    }
}

const filteredExternalResources = computed(() => {
    const list = roster.value?.externalResources ?? [];
    const q = resourceFilter.value.trim().toLowerCase();
    if (!q) return list;
    return list.filter(r =>
        r.name.toLowerCase().includes(q)
        || String(r.id).includes(q),
    );
});

const sortedExternalResources = computed(() => {
    const dir = resourceSortDir.value === 'asc' ? 1 : -1;
    return [...filteredExternalResources.value].sort((a, b) => {
        if (resourceSortBy.value === 'id') {
            return (a.id - b.id) * dir;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
    });
});

function toggleResourceSort(key: 'id' | 'name'): void {
    if (resourceSortBy.value === key) {
        resourceSortDir.value = resourceSortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        resourceSortBy.value  = key;
        resourceSortDir.value = 'asc';
    }
}

const filteredIncidents = computed(() => {
    const list = roster.value?.incidents ?? [];
    const q = incidentFilter.value.trim().toLowerCase();
    if (!q) return list;
    return list.filter(inc =>
        String(inc.id).includes(q)
        || (inc.reference && inc.reference.toLowerCase().includes(q))
        || inc.title.toLowerCase().includes(q)
        || (inc.trackingNumber && inc.trackingNumber.toLowerCase().includes(q))
        || (inc.description && inc.description.toLowerCase().includes(q)),
    );
});

const sortedIncidents = computed(() => {
    const dir = incidentSortDir.value === 'asc' ? 1 : -1;
    return [...filteredIncidents.value].sort((a, b) => {
        if (incidentSortBy.value === 'startsAt' || incidentSortBy.value === 'endsAt') {
            const av = a[incidentSortBy.value] ?? '';
            const bv = b[incidentSortBy.value] ?? '';
            return av.localeCompare(bv) * dir;
        }
        const field = incidentSortBy.value;
        const av = (field === 'reference' ? (a.reference ?? String(a.id)) : (a[field] ?? '')).toLowerCase();
        const bv = (field === 'reference' ? (b.reference ?? String(b.id)) : (b[field] ?? '')).toLowerCase();
        return av.localeCompare(bv, undefined, { sensitivity: 'base' }) * dir;
    });
});

function toggleIncidentSort(key: 'reference' | 'title' | 'startsAt' | 'endsAt' | 'trackingNumber'): void {
    if (incidentSortBy.value === key) {
        incidentSortDir.value = incidentSortDir.value === 'asc' ? 'desc' : 'asc';
    } else {
        incidentSortBy.value  = key;
        incidentSortDir.value = key === 'startsAt' ? 'desc' : 'asc';
    }
}

function formatIncidentDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

async function onIncidentCreated(): Promise<void> {
    roster.value = await loadCachedRoster();
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
            warningsDismissed.value = false;
            const warnCount = result.warnings.length;
            const cats = result.roster.meta.equipmentCategories ?? [];
            const kept = cats.filter(c => c.included);
            const detail = [
                statsLine('Members', result.stats.members),
                statsLine('Equipment', result.stats.equipment),
                `External resources: ${result.stats.externalResources.rawCount} unique across ${result.stats.externalResources.queriesRun} search quer${result.stats.externalResources.queriesRun === 1 ? 'y' : 'ies'}`,
                statsLine('Incidents (last 30 days)', result.stats.incidents),
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
