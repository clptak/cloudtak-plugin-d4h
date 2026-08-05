<template>
    <div class='d-flex flex-column'>
        <TablerInlineAlert
            v-if='!config'
            severity='warning'
            title='D4H Not Configured'
            description='D4H connection is not configured yet. Open the connection settings (gear icon) and run Test Connection first.'
        />

        <TablerBorder
            v-else
            class='cloudtak-accent text-white'
            :fill-height='false'
            :shadow='false'
            gap='sm'
        >
            <template #label>
                <p class='text-uppercase text-white-50 small mb-0'>
                    Submit Incident
                </p>
            </template>

            <form @submit.prevent='onSubmit'>
                <div class='row g-2'>
                    <!-- Mission source: active by default, override via dropdown -->
                    <div class='col-12'>
                        <TablerEnum
                            v-model='missionModel'
                            label='DataSync Mission'
                            :options='missionOptions'
                        />
                        <div class='form-text small text-white-50'>
                            Defaults to the active mission.
                        </div>
                    </div>

                    <!-- CoT point picker → fills location lat/lon -->
                    <div class='col-12'>
                        <TablerEnum
                            v-model='pointModel'
                            label='Location — CoT Point'
                            :options='pointOptions'
                            :disabled='!points.length'
                        />
                        <div class='form-text small text-white-50'>
                            {{ points.length }} point{{ points.length === 1 ? '' : 's' }} in mission
                            <span v-if='selectedPoint'>
                                · latitude {{ selectedPoint.lat }}, longitude {{ selectedPoint.lon }}
                            </span>
                        </div>
                    </div>

                    <!-- Overlay attribute detection -->
                    <div
                        v-if='selectedPoint'
                        class='col-12'
                    >
                        <div class='d-flex gap-2 flex-wrap'>
                            <button
                                type='button'
                                class='btn btn-outline-secondary btn-sm'
                                @click='onInspect'
                            >
                                Inspect Overlays At Point
                            </button>
                            <button
                                v-if='hasOverlayMapping'
                                type='button'
                                class='btn btn-outline-primary btn-sm'
                                :disabled='detecting'
                                @click='onDetect'
                            >
                                {{ detecting ? 'Detecting…' : 'Detect Mapped Fields' }}
                            </button>
                        </div>
                        <div class='form-text small text-white-50'>
                            Reads attributes from overlays that are toggled on. The map recenters on the point first.
                            <span v-if='hasOverlayMapping'>Mapped fields auto-detect when you pick a point; use the button to re-run.</span>
                            <span v-else>Add rows to <code>lib/overlay-field-map.ts</code> to enable auto-fill.</span>
                        </div>

                        <!-- Inspect output: layer ids + property keys for authoring the mapping -->
                        <div
                            v-if='inspectResults'
                            class='cloudtak-accent border rounded-3 text-white px-2 py-2 mt-1 small'
                        >
                            <div v-if='!inspectResults.length'>
                                <div class='text-white-50 mb-1'>
                                    No overlay features matched at this point. Diagnostics below:
                                </div>
                                <div
                                    v-if='inspectDebug'
                                    class='font-monospace'
                                    style='font-size:0.75rem'
                                >
                                    <div>Rendered features here: {{ inspectDebug.totalFeaturesAtPoint }}</div>
                                    <div class='mt-1'>
                                        Overlays toggled on:
                                        <span v-if='!inspectDebug.visibleOverlays.length'>none</span>
                                    </div>
                                    <div
                                        v-for='o in inspectDebug.visibleOverlays'
                                        :key='o.id'
                                    >
                                        • {{ o.name }} (id {{ o.id }}, type {{ o.type || '?' }})
                                    </div>
                                    <div class='mt-1'>
                                        Layers rendered at point (layerId ← source):
                                        <span v-if='!inspectDebug.sampleLayers.length'>none</span>
                                    </div>
                                    <div
                                        v-for='(l, i) in inspectDebug.sampleLayers'
                                        :key='i'
                                    >
                                        • {{ l.layerId }} ← {{ l.source || '(none)' }}
                                    </div>
                                </div>
                            </div>
                            <div
                                v-for='(r, i) in inspectResults'
                                :key='i'
                                class='mb-2'
                            >
                                <div class='fw-semibold'>
                                    <span class='text-white-50 me-1'>overlayLayerId:</span>
                                    <code
                                        class='text-success'
                                        title='Use THIS in overlay-field-map.ts (stable across restarts)'
                                    >{{ r.stableLayerId }}</code>
                                    <code
                                        class='text-white-50 ms-1'
                                        style='font-size:0.7rem'
                                        title='full runtime id — leading number changes on restart'
                                    >({{ r.layerId }})</code>
                                </div>
                                <div
                                    v-for='(val, key) in r.properties'
                                    :key='key'
                                    class='font-monospace'
                                >
                                    {{ key }}: {{ val }}
                                </div>
                            </div>
                        </div>

                        <!-- Detect output -->
                        <div
                            v-if='detectStatus'
                            class='mt-1 small'
                        >
                            <div
                                v-for='(a, i) in detectStatus.applied'
                                :key='"a" + i'
                                class='text-success'
                            >
                                ✓ {{ a }}
                            </div>
                            <div
                                v-for='(u, i) in detectStatus.unmatched'
                                :key='"u" + i'
                                class='text-white-50'
                            >
                                • {{ u }}
                            </div>
                        </div>
                    </div>

                    <!-- Title → referenceDescription -->
                    <div class='col-12'>
                        <TablerInput
                            v-model='form.title'
                            label='Incident Title'
                            placeholder='e.g. Missing hiker — Bear Creek'
                            :required='true'
                        />
                        <div class='form-text small text-white-50'>
                            {{ form.title.length }}/100 — maps to D4H referenceDescription
                        </div>
                    </div>

                    <!-- Description → description (HTML-capable) -->
                    <div class='col-12'>
                        <TablerInput
                            v-model='form.description'
                            label='Description'
                            :rows='4'
                            placeholder='Free-text incident description'
                        />
                    </div>

                    <!-- Start / end times -->
                    <div class='col-12 col-md-6'>
                        <TablerInput
                            v-model='form.startsAtLocal'
                            label='Starts At'
                            type='datetime-local'
                            :required='true'
                        />
                        <div class='form-text small text-white-50'>
                            Pre-filled from mission creation time. Sent as UTC: {{ startsAtUTC || '—' }}
                        </div>
                    </div>
                    <div class='col-12 col-md-6'>
                        <TablerInput
                            v-model='form.endsAtLocal'
                            label='Ends At'
                            type='datetime-local'
                        />
                        <div class='form-text small text-white-50'>
                            Optional.
                        </div>
                    </div>

                    <!-- Full team toggle; member-group multi-select when off -->
                    <div class='col-12'>
                        <TablerToggle
                            :model-value='form.fullTeam'
                            label='Full Team'
                            @update:model-value='onFullTeamToggle'
                        />
                    </div>

                    <div
                        v-if='!form.fullTeam'
                        class='col-12'
                    >
                        <div class='row'>
                            <div class='col-12 d-flex my-1'>
                                <div class='align-self-center'>
                                    <div class='px-2'>
                                        <span class='user-select-none'>Member Groups</span>
                                    </div>
                                </div>
                            </div>
                            <div class='col-12'>
                                <select
                                    v-model='form.selectedGroupIds'
                                    class='form-select form-select-sm'
                                    multiple
                                    size='5'
                                    :disabled='groupsLoading'
                                >
                                    <option
                                        v-for='g in memberGroups'
                                        :key='g.id'
                                        :value='g.id'
                                    >
                                        {{ g.title }}
                                    </option>
                                </select>
                            </div>
                        </div>
                        <div class='form-text small text-white-50'>
                            {{ groupsLoading ? 'Loading groups…' : 'Selection is captured but not yet submitted (v1).' }}
                        </div>
                    </div>

                    <!-- Dynamic incident custom fields -->
                    <div
                        v-if='cfLoading'
                        class='col-12 text-white-50 small'
                    >
                        Loading incident fields…
                    </div>
                    <template v-else-if='customFields.length'>
                        <div class='col-12'>
                            <p class='text-uppercase text-white-50 small mb-0 mt-1'>
                                Incident Details
                            </p>
                        </div>
                        <div
                            v-for='f in customFields'
                            :key='f.id'
                            class='col-12'
                        >
                            <TablerInput
                                v-if='f.type === "TEXT_AREA"'
                                v-model='cfValues[f.id]'
                                :label='f.title'
                                :rows='3'
                                :required='f.mandatory'
                            />
                            <TablerEnum
                                v-else-if='f.type === "SINGLE_CHOICE"'
                                :model-value='cfSingleChoiceLabel(f)'
                                :label='f.title'
                                :required='f.mandatory'
                                :options='cfSingleChoiceOptions(f)'
                                @update:model-value='(v: string) => onCfSingleChoiceChange(f, v)'
                            />
                            <div
                                v-else-if='f.type === "MULTIPLE_CHOICE"'
                                class='row'
                            >
                                <div class='col-12 d-flex my-1'>
                                    <div class='align-self-center'>
                                        <div class='px-2'>
                                            <span class='user-select-none'>{{ f.title }}</span>
                                            <span
                                                v-if='f.mandatory'
                                                class='text-red mx-1'
                                            >*</span>
                                        </div>
                                    </div>
                                </div>
                                <div class='col-12'>
                                    <select
                                        v-model='cfValues[f.id]'
                                        class='form-select form-select-sm'
                                        multiple
                                        size='4'
                                    >
                                        <option
                                            v-for='o in f.options'
                                            :key='o.id'
                                            :value='o.id'
                                        >
                                            {{ o.label }}
                                        </option>
                                    </select>
                                </div>
                            </div>
                            <TablerInput
                                v-else
                                v-model='cfValues[f.id]'
                                :label='f.title'
                                :type='inputTypeFor(f.type)'
                                :required='f.mandatory'
                            />

                            <div class='form-text small text-white-50'>
                                <span v-if='f.hint'>{{ f.hint }}</span>
                                <code
                                    class='text-white-50 ms-1'
                                    title='custom field id — use in overlay-field-map.ts'
                                >#{{ f.id }}</code>
                            </div>
                        </div>
                    </template>

                    <div
                        v-if='missingMandatory.length'
                        class='col-12'
                    >
                        <TablerInlineAlert
                            severity='danger'
                            :title='missingMandatoryTitle'
                            :description='missingMandatory.join(", ")'
                        />
                    </div>

                    <div class='col-12'>
                        <button
                            type='submit'
                            class='btn btn-primary w-100'
                            :disabled='submitting || !canSubmit'
                        >
                            {{ submitting ? 'Submitting…' : 'Submit Incident' }}
                        </button>
                    </div>
                </div>
            </form>
        </TablerBorder>

        <!-- Result / errors -->
        <TablerInlineAlert
            v-if='resultAlert'
            class='mt-3'
            :severity='resultAlert.severity'
            :title='resultAlert.title'
            :description='resultAlert.description'
        />
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
    TablerBorder,
    TablerEnum,
    TablerInlineAlert,
    TablerInput,
    TablerToggle,
} from '@tak-ps/vue-tabler';
import { loadConfig, type D4HConfig } from '../lib/d4h-config.ts';
import {
    peekIncidentReference,
    createIncident,
    listMemberGroups,
    listIncidentCustomFields,
    type D4HIncidentCreate,
    type MemberGroupOption,
    type D4HCustomField,
    type D4HCustomFieldType,
} from '../lib/d4h-client.ts';

import { OVERLAY_FIELD_MAP } from '../lib/overlay-field-map.ts';
import { incidentFromCreateResponse } from '../lib/d4h-normalize.ts';
import { upsertCachedIncident } from '../lib/d4h-roster.ts';
import {
    inspectAtPoint,
    debugAtPoint,
    detectValues,
    normalizeLabel,
    type MapLike,
    type OverlayLike,
    type InspectResult,
    type DetectResult,
    type DetectDebug,
} from '../lib/overlay-detect.ts';

// Core CloudTAK surfaces (unofficial — see docs/PLAN-submit-incident.md "RESOLVED").
import { useMapStore } from '../../../src/stores/map.ts';
import { db } from '../../../src/database.ts';

interface MissionRef { guid: string; name: string }
interface PointPick  { id: string; label: string; lat: number; lon: number }

const emit = defineEmits<{
    'incident-created': [];
}>();

const config              = ref<D4HConfig | null>(null);
const missions            = ref<MissionRef[]>([]);
const activeMissionGuid   = ref<string | undefined>(undefined);
const selectedMissionGuid = ref<string | undefined>(undefined);
const points              = ref<PointPick[]>([]);
const selectedPointId     = ref<string | undefined>(undefined);

const memberGroups = ref<MemberGroupOption[]>([]);
const groupsLoading = ref(false);

const customFields = ref<D4HCustomField[]>([]);
const cfLoading = ref(false);

const hasOverlayMapping = OVERLAY_FIELD_MAP.length > 0;
const inspectResults = ref<InspectResult[] | null>(null);
const inspectDebug = ref<DetectDebug | null>(null);
const detecting = ref(false);
const detectStatus = ref<{ applied: string[]; unmatched: string[] } | null>(null);
// Field id → entered value. Heterogeneous by field type: string for text/number/date/time,
// number for SINGLE_CHOICE, number[] for MULTIPLE_CHOICE — hence `any` for the v-model slot.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cfValues = reactive<Record<number, any>>({});

const submitting = ref(false);
const result = ref<
    | { ok: true; id: unknown; reference: string | null }
    | { ok: false; message: string; hint?: string }
    | null
>(null);

const form = reactive({
    title:           '',
    description:     '',
    startsAtLocal:   '',
    endsAtLocal:     '',
    fullTeam:        true,
    selectedGroupIds: [] as number[],
});

const selectedPoint = computed(() => points.value.find(p => p.id === selectedPointId.value) ?? null);

// ── TablerEnum label ↔ id/guid mapping (TablerEnum only supports string options) ───────────────
function missionLabel(m: MissionRef): string {
    return `${m.name}${m.guid === activeMissionGuid.value ? ' (active)' : ''}`;
}

const missionOptions = computed(() =>
    missions.value.length ? missions.value.map(missionLabel) : ['No loaded missions'],
);

const missionModel = computed<string>({
    get: () => {
        const m = missions.value.find(x => x.guid === selectedMissionGuid.value);
        return m ? missionLabel(m) : 'No loaded missions';
    },
    set: (label) => {
        const m = missions.value.find(x => missionLabel(x) === label);
        if (!m || m.guid === selectedMissionGuid.value) return;
        selectedMissionGuid.value = m.guid;
        void onMissionChange();
    },
});

function pointLabel(p: PointPick): string {
    return `${p.label} — ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

const pointPlaceholder = computed(() => (points.value.length ? 'Select a point…' : 'No points in this mission'));

const pointOptions = computed(() => [pointPlaceholder.value, ...points.value.map(pointLabel)]);

const pointModel = computed<string>({
    get: () => (selectedPoint.value ? pointLabel(selectedPoint.value) : pointPlaceholder.value),
    set: (label) => {
        if (label === pointPlaceholder.value) {
            selectedPointId.value = undefined;
            return;
        }
        const p = points.value.find(x => pointLabel(x) === label);
        selectedPointId.value = p?.id;
    },
});

function onFullTeamToggle(v: boolean): void {
    form.fullTeam = v;
    void onFullTeamChange();
}

// datetime-local (naive local) → UTC ISO 8601 with Z.
function localInputToUTC(v: string): string | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
// ISO (any zone) → datetime-local value in the viewer's local time.
function isoToLocalInput(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const startsAtUTC = computed(() => localInputToUTC(form.startsAtLocal));

// Map a D4H field type to an <input type=…> (choice/textarea handled separately in template).
function inputTypeFor(t: D4HCustomFieldType): string {
    switch (t) {
        case 'NUMBER':   return 'number';
        case 'DATE':     return 'date';
        case 'DATETIME': return 'datetime-local';
        case 'TIME':     return 'time';
        default:         return 'text';
    }
}

// TablerEnum label ↔ option-id mapping for SINGLE_CHOICE custom fields.
const CF_SINGLE_CHOICE_NONE = '—';

function cfSingleChoiceOptions(f: D4HCustomField): string[] {
    return [CF_SINGLE_CHOICE_NONE, ...f.options.map(o => o.label)];
}

function cfSingleChoiceLabel(f: D4HCustomField): string {
    const opt = f.options.find(o => o.id === cfValues[f.id]);
    return opt?.label ?? CF_SINGLE_CHOICE_NONE;
}

function onCfSingleChoiceChange(f: D4HCustomField, label: string): void {
    if (label === CF_SINGLE_CHOICE_NONE) {
        cfValues[f.id] = undefined;
        return;
    }
    cfValues[f.id] = f.options.find(o => o.label === label)?.id;
}

function cfIsEmpty(f: D4HCustomField): boolean {
    const v = cfValues[f.id];
    if (f.type === 'MULTIPLE_CHOICE') return !Array.isArray(v) || v.length === 0;
    if (f.type === 'SINGLE_CHOICE')   return v == null || v === '';
    return String(v ?? '').trim() === '';
}

const missingMandatory = computed(() =>
    customFields.value.filter(f => f.mandatory && cfIsEmpty(f)).map(f => f.title),
);

const missingMandatoryTitle = computed(() =>
    missingMandatory.value.length === 1 ? 'Required Field Missing' : 'Required Fields Missing',
);

/** Assemble the incident POST's customFieldValues from filled fields only. */
function buildCustomFieldValues(): Array<{ id: number; value: number[] | string }> {
    const out: Array<{ id: number; value: number[] | string }> = [];
    for (const f of customFields.value) {
        if (cfIsEmpty(f)) continue;
        const v = cfValues[f.id];
        if (f.type === 'MULTIPLE_CHOICE') {
            out.push({ id: f.id, value: (v as unknown[]).map(Number).filter(Number.isFinite) });
        } else if (f.type === 'SINGLE_CHOICE') {
            out.push({ id: f.id, value: [Number(v)] });
        } else if (f.type === 'DATETIME') {
            const iso = localInputToUTC(String(v));
            if (iso) out.push({ id: f.id, value: iso });
        } else {
            out.push({ id: f.id, value: String(v).trim() });
        }
    }
    return out;
}

const canSubmit = computed(() =>
    !!config.value
    && form.title.trim().length > 0
    && !!selectedPoint.value
    && !!startsAtUTC.value
    && missingMandatory.value.length === 0,
);

// Success/failure → TablerInlineAlert props.
const resultAlert = computed(() => {
    if (!result.value) return null;
    if (result.value.ok) {
        return {
            severity: 'success' as const,
            title: `Incident Created — D4H ID ${result.value.id}`,
            description: `${result.value.reference ? `Ref ${result.value.reference}. ` : ''}Added to the Incidents list for this mission.`,
        };
    }
    return {
        severity: 'danger' as const,
        title: 'Submit Failed',
        description: [result.value.message, result.value.hint].filter(Boolean).join(' — '),
    };
});

onMounted(async () => {
    config.value = await loadConfig();

    // Active mission (if any) drives the defaults; dropdown lets the user override.
    const mapStore = useMapStore();
    activeMissionGuid.value = mapStore.mission?.guid;

    // Locally-loaded missions for the override dropdown.
    const subs = await db.subscription.toArray();
    missions.value = subs
        .map(s => ({ guid: s.guid, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    selectedMissionGuid.value = activeMissionGuid.value ?? missions.value[0]?.guid;
    await loadMission(selectedMissionGuid.value);

    await loadCustomFields();
});

async function loadCustomFields(): Promise<void> {
    if (!config.value) return;
    cfLoading.value = true;
    try {
        const fields = await listIncidentCustomFields(config.value);
        customFields.value = fields;
        // Seed reactive values so v-model has a defined slot per field.
        for (const f of fields) {
            cfValues[f.id] = f.type === 'MULTIPLE_CHOICE' ? [] : '';
        }
    } catch (e) {
        // Non-fatal: incident can still submit without custom fields.
        console.warn('[d4h] custom fields load failed:', (e as Error).message);
    } finally {
        cfLoading.value = false;
    }
}

// ── Overlay attribute detection ────────────────────────────────────────────────
type RecenterMap = MapLike & {
    jumpTo(opts: { center: [number, number] }): void;
    once(ev: string, cb: () => void): void;
};

function overlaysFromStore(): OverlayLike[] {
    // overlays exists at runtime but is not on Store<> in CloudTAK 13.5+ typings
    const store = useMapStore() as unknown as { overlays?: OverlayLike[] };
    return store.overlays ?? [];
}

/** Recenter the map on the point so the overlay tiles render there, then wait for idle. */
async function recenterTo(lonLat: [number, number]): Promise<MapLike | null> {
    const map = useMapStore().map as unknown as RecenterMap | undefined;
    if (!map) return null;
    map.jumpTo({ center: lonLat });
    await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        // Resolve once tiles for the new center have loaded and rendering is idle.
        map.once('idle', done);
        // Safety: don't hang forever if 'idle' never fires (long fallback so far jumps can load).
        setTimeout(done, 4000);
    });
    return map;
}

async function onInspect(): Promise<void> {
    if (!selectedPoint.value) return;
    detectStatus.value = null;
    const lonLat: [number, number] = [selectedPoint.value.lon, selectedPoint.value.lat];
    const map = await recenterTo(lonLat);
    if (!map) return;
    inspectResults.value = inspectAtPoint(map, lonLat);
    // If nothing matched, capture what IS rendered there to diagnose.
    inspectDebug.value = inspectResults.value.length ? null : debugAtPoint(map, overlaysFromStore(), lonLat);
}

async function onDetect(): Promise<void> {
    if (!selectedPoint.value || !hasOverlayMapping) return;
    detecting.value = true;
    inspectResults.value = null;
    inspectDebug.value = null;
    try {
        const lonLat: [number, number] = [selectedPoint.value.lon, selectedPoint.value.lat];
        const map = await recenterTo(lonLat);
        if (!map) return;
        applyDetected(detectValues(map, lonLat, OVERLAY_FIELD_MAP));
    } finally {
        detecting.value = false;
    }
}

function applyDetected(results: DetectResult[]): void {
    const applied: string[] = [];
    const unmatched: string[] = [];
    for (const r of results) {
        const f = customFields.value.find(cf => cf.id === r.customFieldId);
        if (!f) { unmatched.push(`field ${r.customFieldId} (not an incident field)`); continue; }
        if (r.value == null) { unmatched.push(`${f.title}: no overlay value at point`); continue; }

        if (f.type === 'SINGLE_CHOICE' || f.type === 'MULTIPLE_CHOICE') {
            const opt = f.options.find(o => normalizeLabel(o.label) === normalizeLabel(r.value as string));
            if (!opt) { unmatched.push(`${f.title}: "${r.value}" has no matching option`); continue; }
            if (f.type === 'SINGLE_CHOICE') {
                cfValues[f.id] = opt.id;
            } else {
                const arr = Array.isArray(cfValues[f.id]) ? cfValues[f.id] as number[] : [];
                if (!arr.includes(opt.id)) arr.push(opt.id);
                cfValues[f.id] = arr;
            }
            applied.push(`${f.title} → ${opt.label}`);
        } else {
            cfValues[f.id] = r.value;
            applied.push(`${f.title} → ${r.value}`);
        }
    }
    detectStatus.value = { applied, unmatched };
}

// Auto-detect the moment a point is picked (only if a mapping exists). The detect path recenters
// the map on the point — acceptable here because the user just chose that point.
watch(selectedPointId, (id) => {
    if (id != null && hasOverlayMapping) void onDetect();
});

async function onMissionChange(): Promise<void> {
    inspectResults.value = null;
    inspectDebug.value = null;
    detectStatus.value = null;
    await loadMission(selectedMissionGuid.value);
}

async function loadMission(guid?: string): Promise<void> {
    selectedPointId.value = undefined;
    points.value = [];
    if (!guid) return;

    // CoT points live in db.subscription_feature (NOT db.feature / PluginAPI.feature).
    const feats = await db.subscription_feature.where('mission').equals(guid).toArray();
    points.value = feats
        .filter(f => f.geometry && f.geometry.type === 'Point')
        .map(f => {
            const [lon, lat] = (f.geometry as { coordinates: number[] }).coordinates;
            const props = (f.properties ?? {}) as Record<string, unknown>;
            const label = String(props.callsign ?? props.name ?? f.id);
            return { id: f.id, label, lat, lon };
        })
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .sort((a, b) => a.label.localeCompare(b.label));

    // Default startsAt from the mission's creation time.
    const sub = await db.subscription.get(guid);
    const createTime = (sub?.meta as { createTime?: string } | undefined)?.createTime;
    form.startsAtLocal = isoToLocalInput(createTime) || isoToLocalInput(new Date().toISOString());
}

async function onFullTeamChange(): Promise<void> {
    if (form.fullTeam || memberGroups.value.length || !config.value) return;
    groupsLoading.value = true;
    try {
        memberGroups.value = await listMemberGroups(config.value);
    } catch (e) {
        result.value = { ok: false, message: `Could not load member groups: ${(e as Error).message}` };
    } finally {
        groupsLoading.value = false;
    }
}

async function onSubmit(): Promise<void> {
    if (!config.value || !canSubmit.value || !selectedPoint.value || !startsAtUTC.value) return;
    submitting.value = true;
    result.value = null;

    try {
        const payload: D4HIncidentCreate = {
            referenceDescription: form.title.trim().slice(0, 100),
            description:          form.description.trim() || null,
            shared:              true,
            fullTeam:            form.fullTeam,
            address:             { country: '', postcode: '', region: '', street: '', town: '' },
            location:            { latitude: selectedPoint.value.lat, longitude: selectedPoint.value.lon },
            startsAt:            startsAtUTC.value,
        };
        const endsAt = localInputToUTC(form.endsAtLocal);
        if (endsAt) payload.endsAt = endsAt;

        const customFieldValues = buildCustomFieldValues();
        if (customFieldValues.length) payload.customFieldValues = customFieldValues;

        // Team has auto-id enabled → peek the next reference (no side effect) and include it.
        let reference: string | null = null;
        try {
            reference = await peekIncidentReference(config.value);
            if (reference) payload.reference = reference;
        } catch {
            // Non-fatal: if peek fails, submit without a reference and let D4H auto-assign.
            reference = null;
        }

        const created = await createIncident(config.value, payload);
        const id = (created.id ?? created.activityId) as unknown;

        const endsAtIso = localInputToUTC(form.endsAtLocal) ?? undefined;
        const incident = incidentFromCreateResponse(created, {
            title:       form.title.trim().slice(0, 100),
            reference:   reference ?? undefined,
            startsAt:    startsAtUTC.value,
            endsAt:      endsAtIso,
            description: form.description.trim() || undefined,
            missionGuid: selectedMissionGuid.value,
        });
        if (incident) {
            await upsertCachedIncident(incident);
            emit('incident-created');
        }

        result.value = { ok: true, id, reference };
    } catch (e) {
        const err = e as Error & { status?: number };
        const hint = err.status === 401 || err.status === 403
            ? 'The token authenticated for reads but was rejected here — confirm it has write/incident scope in D4H.'
            : undefined;
        result.value = { ok: false, message: err.message, hint };
    } finally {
        submitting.value = false;
    }
}
</script>
