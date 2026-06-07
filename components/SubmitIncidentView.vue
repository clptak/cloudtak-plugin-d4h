<template>
    <div class='d-flex flex-column h-100 overflow-auto p-3'>
        <h5 class='mb-3'>
            Submit incident to D4H
        </h5>

        <div
            v-if='!config'
            class='alert alert-warning py-2 small'
        >
            D4H connection is not configured yet. Open the connection settings (gear icon) and run
            <strong>Test connection</strong> first.
        </div>

        <form
            v-else
            @submit.prevent='onSubmit'
        >
            <!-- Mission source: active by default, override via dropdown -->
            <div class='mb-3'>
                <label class='form-label small fw-semibold'>
                    DataSync mission
                    <span class='text-muted fw-normal'>(defaults to active mission)</span>
                </label>
                <select
                    v-model='selectedMissionGuid'
                    class='form-select form-select-sm'
                    @change='onMissionChange'
                >
                    <option
                        v-if='!missions.length'
                        :value='undefined'
                    >
                        No loaded missions
                    </option>
                    <option
                        v-for='m in missions'
                        :key='m.guid'
                        :value='m.guid'
                    >
                        {{ m.name }}{{ m.guid === activeMissionGuid ? ' (active)' : '' }}
                    </option>
                </select>
            </div>

            <!-- CoT point picker → fills location lat/lon -->
            <div class='mb-3'>
                <label class='form-label small fw-semibold'>
                    Location — CoT point
                    <span class='text-muted fw-normal'>({{ points.length }} point{{ points.length === 1 ? '' : 's' }} in mission)</span>
                </label>
                <select
                    v-model='selectedPointId'
                    class='form-select form-select-sm'
                    :disabled='!points.length'
                >
                    <option :value='undefined'>
                        {{ points.length ? 'Select a point…' : 'No points in this mission' }}
                    </option>
                    <option
                        v-for='p in points'
                        :key='p.id'
                        :value='p.id'
                    >
                        {{ p.label }} — {{ p.lat.toFixed(5) }}, {{ p.lon.toFixed(5) }}
                    </option>
                </select>
                <div
                    v-if='selectedPoint'
                    class='form-text small'
                >
                    latitude {{ selectedPoint.lat }}, longitude {{ selectedPoint.lon }}
                </div>
            </div>

            <!-- Title → referenceDescription -->
            <div class='mb-3'>
                <label class='form-label small fw-semibold'>
                    Incident title <span class='text-danger'>*</span>
                </label>
                <input
                    v-model='form.title'
                    type='text'
                    maxlength='100'
                    class='form-control form-control-sm'
                    placeholder='e.g. Missing hiker — Bear Creek'
                    required
                >
                <div class='form-text small'>
                    {{ form.title.length }}/100 — maps to D4H referenceDescription
                </div>
            </div>

            <!-- Description → description (HTML-capable) -->
            <div class='mb-3'>
                <label class='form-label small fw-semibold'>Description</label>
                <textarea
                    v-model='form.description'
                    rows='4'
                    class='form-control form-control-sm'
                    placeholder='Free-text incident description'
                />
            </div>

            <!-- Start / end times -->
            <div class='row g-2 mb-3'>
                <div class='col-12 col-md-6'>
                    <label class='form-label small fw-semibold'>
                        Starts at <span class='text-danger'>*</span>
                    </label>
                    <input
                        v-model='form.startsAtLocal'
                        type='datetime-local'
                        class='form-control form-control-sm'
                        required
                    >
                    <div class='form-text small'>
                        Pre-filled from mission creation time. Sent as UTC: {{ startsAtUTC || '—' }}
                    </div>
                </div>
                <div class='col-12 col-md-6'>
                    <label class='form-label small fw-semibold'>
                        Ends at <span class='text-muted fw-normal'>(optional)</span>
                    </label>
                    <input
                        v-model='form.endsAtLocal'
                        type='datetime-local'
                        class='form-control form-control-sm'
                    >
                </div>
            </div>

            <!-- Full team toggle; member-group multi-select when off -->
            <div class='mb-3'>
                <div class='form-check form-switch'>
                    <input
                        id='d4h-full-team'
                        v-model='form.fullTeam'
                        class='form-check-input'
                        type='checkbox'
                        @change='onFullTeamChange'
                    >
                    <label
                        class='form-check-label small fw-semibold'
                        for='d4h-full-team'
                    >
                        Full team
                    </label>
                </div>

                <div
                    v-if='!form.fullTeam'
                    class='mt-2'
                >
                    <label class='form-label small fw-semibold'>Member groups</label>
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
                    <div class='form-text small'>
                        {{ groupsLoading ? 'Loading groups…' : 'Selection is captured but not yet submitted (v1).' }}
                    </div>
                </div>
            </div>

            <!-- Dynamic incident custom fields -->
            <div
                v-if='cfLoading'
                class='text-muted small mb-3'
            >
                Loading incident fields…
            </div>
            <div
                v-else-if='customFields.length'
                class='mb-3'
            >
                <label class='form-label small fw-semibold d-block'>Incident details</label>
                <div
                    v-for='f in customFields'
                    :key='f.id'
                    class='mb-2'
                >
                    <label class='form-label small mb-1'>
                        {{ f.title }}
                        <span
                            v-if='f.mandatory'
                            class='text-danger'
                        >*</span>
                    </label>

                    <textarea
                        v-if='f.type === "TEXT_AREA"'
                        v-model='cfValues[f.id]'
                        rows='3'
                        class='form-control form-control-sm'
                    />
                    <select
                        v-else-if='f.type === "SINGLE_CHOICE"'
                        v-model='cfValues[f.id]'
                        class='form-select form-select-sm'
                    >
                        <option :value='undefined'>
                            —
                        </option>
                        <option
                            v-for='o in f.options'
                            :key='o.id'
                            :value='o.id'
                        >
                            {{ o.label }}
                        </option>
                    </select>
                    <select
                        v-else-if='f.type === "MULTIPLE_CHOICE"'
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
                    <input
                        v-else
                        v-model='cfValues[f.id]'
                        :type='inputTypeFor(f.type)'
                        class='form-control form-control-sm'
                    >

                    <div
                        v-if='f.hint'
                        class='form-text small'
                    >
                        {{ f.hint }}
                    </div>
                </div>
            </div>

            <div
                v-if='missingMandatory.length'
                class='text-danger small mb-2'
            >
                Required field{{ missingMandatory.length === 1 ? '' : 's' }}: {{ missingMandatory.join(', ') }}
            </div>

            <button
                type='submit'
                class='btn btn-primary btn-sm'
                :disabled='submitting || !canSubmit'
            >
                {{ submitting ? 'Submitting…' : 'Submit incident' }}
            </button>
        </form>

        <!-- Result / errors -->
        <div
            v-if='result'
            class='alert mt-3 py-2 small'
            :class='result.ok ? "alert-success" : "alert-danger"'
        >
            <div v-if='result.ok'>
                Incident created — D4H id <strong>{{ result.id }}</strong>{{ result.reference ? ` (ref ${result.reference})` : '' }}.
            </div>
            <div v-else>
                <strong>Submit failed.</strong> {{ result.message }}
                <div
                    v-if='result.hint'
                    class='mt-1 text-muted'
                >
                    {{ result.hint }}
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, reactive, ref } from 'vue';
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

// Core CloudTAK surfaces (unofficial — see docs/PLAN-submit-incident.md "RESOLVED").
import { useMapStore } from '../../../src/stores/map.ts';
import { db } from '../../../src/database.ts';

interface MissionRef { guid: string; name: string }
interface PointPick  { id: string; label: string; lat: number; lon: number }

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

function cfIsEmpty(f: D4HCustomField): boolean {
    const v = cfValues[f.id];
    if (f.type === 'MULTIPLE_CHOICE') return !Array.isArray(v) || v.length === 0;
    if (f.type === 'SINGLE_CHOICE')   return v == null || v === '';
    return String(v ?? '').trim() === '';
}

const missingMandatory = computed(() =>
    customFields.value.filter(f => f.mandatory && cfIsEmpty(f)).map(f => f.title),
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

async function onMissionChange(): Promise<void> {
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
