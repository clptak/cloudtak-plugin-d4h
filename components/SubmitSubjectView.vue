<template>
    <div class='d-flex flex-column'>
        <h5 class='mb-3'>
            Submit subject to D4H
        </h5>

        <div
            v-if='!config'
            class='alert alert-warning py-2 small'
        >
            D4H connection is not configured yet. Open the connection settings and run
            <strong>Test connection</strong> first.
        </div>

        <template v-else>
            <div class='mb-3'>
                <label class='form-label small fw-semibold'>
                    Incident
                    <span class='text-muted fw-normal'>(from last sync)</span>
                </label>
                <select
                    v-model.number='selectedIncidentId'
                    class='form-select form-select-sm'
                    :disabled='!incidentOptions.length'
                >
                    <option
                        v-if='!incidentOptions.length'
                        :value='undefined'
                    >
                        No incidents — run Sync now
                    </option>
                    <option
                        v-for='opt in incidentOptions'
                        :key='opt.id'
                        :value='opt.id'
                    >
                        {{ opt.label }}
                    </option>
                </select>
                <div
                    v-if='selectedIncident'
                    class='form-text small'
                >
                    Incident ID {{ selectedIncident.id }}
                    <span
                        v-if='selectedIncident.published === true'
                        class='badge bg-warning text-dark ms-1'
                    >Published</span>
                </div>
            </div>

            <div class='mb-3'>
                <label class='form-label small fw-semibold'>
                    DataSync mission
                    <span class='text-muted fw-normal'>(subject information source)</span>
                </label>
                <select
                    v-model='selectedMissionGuid'
                    class='form-select form-select-sm'
                    :disabled='!missions.length'
                    @change='loadSubjects'
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
                        {{ m.name }}{{ m.guid === linkedMissionGuid ? ' (linked)' : '' }}
                    </option>
                </select>
            </div>

            <div class='d-flex gap-2 flex-wrap mb-3'>
                <select
                    v-model='selectedSubjectCaseId'
                    class='form-select form-select-sm'
                    style='max-width:12rem'
                    :disabled='!subjects.length'
                    @change='applySelectedSubject'
                >
                    <option
                        v-if='!subjects.length'
                        value=''
                    >
                        No subjects in mission
                    </option>
                    <option
                        v-for='s in subjects'
                        :key='s.subjectCaseID'
                        :value='s.subjectCaseID'
                    >
                        Subject {{ displaySubjectNumber(s.subjectCaseID) }}{{ s.subjectName ? ` — ${s.subjectName}` : '' }}
                    </option>
                </select>
                <button
                    type='button'
                    class='btn btn-outline-secondary btn-sm'
                    :disabled='!selectedMissionGuid || loadingSubjects'
                    @click='loadSubjects'
                >
                    <span
                        v-if='loadingSubjects'
                        class='spinner-border spinner-border-sm me-1'
                    />
                    {{ loadingSubjects ? 'Loading…' : 'Reload subjects' }}
                </button>
            </div>

            <div
                v-if='loadError'
                class='alert alert-danger py-2 small'
            >
                {{ loadError }}
            </div>

            <div
                v-else-if='subjectsLoaded && !subjects.length'
                class='alert alert-warning py-2 small mb-3'
            >
                No subject-information logs on this mission. Enter subject details in the
                incident-manager Logger → Subject Information tab first.
            </div>

            <div
                v-if='selectedIncident?.published === true'
                class='alert alert-warning py-2 small mb-3'
            >
                This incident is <strong>published</strong> in D4H. Person-involved writes may be
                rejected after publish. Use an unpublished incident or unpublish in D4H Team Manager.
            </div>

            <form
                v-if='metadataLoaded'
                @submit.prevent='onSubmit'
            >
                <div class='small fw-semibold mb-2 border-bottom pb-1'>
                    Person involved
                </div>

                <div class='row g-2 mb-2'>
                    <div class='col-md-6'>
                        <label class='form-label small mb-1'>
                            Name
                        </label>
                        <input
                            v-model='form.name'
                            type='text'
                            class='form-control form-control-sm'
                        >
                    </div>
                    <div class='col-md-3'>
                        <label class='form-label small mb-1'>
                            Date of birth
                        </label>
                        <input
                            v-model='form.dateOfBirth'
                            type='date'
                            class='form-control form-control-sm'
                            @change='onDobChange'
                        >
                    </div>
                    <div class='col-md-3'>
                        <label class='form-label small mb-1'>
                            Age
                        </label>
                        <input
                            v-model='form.age'
                            type='number'
                            min='0'
                            class='form-control form-control-sm'
                            :disabled='!!form.dateOfBirth'
                        >
                    </div>
                </div>

                <div class='row g-2 mb-2'>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Sex
                        </label>
                        <select
                            v-model='form.sex'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in SEX_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Involvement type <span class='text-danger'>*</span>
                        </label>
                        <select
                            v-model.number='form.involvementTypeId'
                            class='form-select form-select-sm'
                            required
                            @change='form.outcomeId = ""'
                        >
                            <option :value='""'>
                                Select type…
                            </option>
                            <option
                                v-for='t in involvementTypes'
                                :key='t.id'
                                :value='t.id'
                            >
                                {{ t.title }}
                            </option>
                        </select>
                    </div>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Outcome
                            <span
                                v-if='filteredOutcomes.length'
                                class='text-danger'
                            >*</span>
                        </label>
                        <select
                            v-model.number='form.outcomeId'
                            class='form-select form-select-sm'
                            :disabled='!filteredOutcomes.length'
                            :required='filteredOutcomes.length > 0'
                        >
                            <option :value='""'>
                                —
                            </option>
                            <option
                                v-for='o in filteredOutcomes'
                                :key='o.id'
                                :value='o.id'
                            >
                                {{ o.title }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class='row g-2 mb-2'>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Nationality
                        </label>
                        <select
                            v-model='form.nationality'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in NATIONALITY_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Area knowledge
                        </label>
                        <select
                            v-model='form.areaKnowledge'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in AREA_KNOWLEDGE_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Cause
                        </label>
                        <select
                            v-model='form.cause'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in CAUSE_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class='row g-2 mb-2'>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Handover
                        </label>
                        <select
                            v-model='form.handover'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in HANDOVER_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Spinal injury
                        </label>
                        <select
                            v-model='form.spinalInjury'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in SPINAL_INJURY_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                    <div class='col-md-4'>
                        <label class='form-label small mb-1'>
                            Transfer
                        </label>
                        <select
                            v-model='form.transfer'
                            class='form-select form-select-sm'
                        >
                            <option value=''>
                                —
                            </option>
                            <option
                                v-for='o in TRANSFER_OPTIONS'
                                :key='o.value'
                                :value='o.value'
                            >
                                {{ o.label }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class='row g-2 mb-2'>
                    <div class='col-md-6'>
                        <label class='form-label small mb-1'>
                            Assistance
                        </label>
                        <input
                            v-model='form.assistance'
                            type='text'
                            class='form-control form-control-sm'
                        >
                    </div>
                    <div class='col-md-6'>
                        <label class='form-label small mb-1'>
                            Contact
                        </label>
                        <input
                            v-model='form.contact'
                            type='text'
                            class='form-control form-control-sm'
                        >
                    </div>
                </div>

                <div class='mb-3'>
                    <label class='form-label small mb-1'>
                        Involvement notes
                    </label>
                    <textarea
                        v-model='form.involvementNotes'
                        rows='4'
                        class='form-control form-control-sm'
                        placeholder='Pre-filled from mission subject details that have no direct D4H field'
                    />
                </div>

                <div
                    v-if='cfLoading'
                    class='text-muted small mb-3'
                >
                    Loading custom fields…
                </div>
                <div
                    v-else-if='customFields.length'
                    class='mb-3'
                >
                    <div class='small fw-semibold mb-2 border-bottom pb-1'>
                        Custom fields
                    </div>
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
                    v-if='missingMandatory.length || !outcomeValid || invalidMandatoryCustom.length'
                    class='text-danger small mb-2'
                >
                    <span v-if='outcomeRequired && form.outcomeId === ""'>
                        Outcome is required for the selected involvement type.
                    </span>
                    <span v-else-if='!outcomeValid'>
                        Select a valid outcome for the chosen involvement type.
                    </span>
                    <span v-if='invalidMandatoryCustom.length'>
                        Custom field{{ invalidMandatoryCustom.length === 1 ? '' : 's' }} have invalid format:
                        {{ invalidMandatoryCustom.join(', ') }}
                    </span>
                    <span v-if='missingMandatory.length'>
                        Required custom field{{ missingMandatory.length === 1 ? '' : 's' }}:
                        {{ missingMandatory.join(', ') }}
                    </span>
                </div>

                <button
                    type='submit'
                    class='btn btn-primary btn-sm'
                    :disabled='submitting || !canSubmit'
                >
                    <span
                        v-if='submitting'
                        class='spinner-border spinner-border-sm me-1'
                    />
                    {{ submitting ? 'Submitting…' : 'Submit subject' }}
                </button>
            </form>

            <div
                v-else-if='metadataLoading'
                class='text-muted small'
            >
                Loading D4H involved-person metadata…
            </div>

            <div
                v-if='result'
                class='alert mt-3 py-2 small'
                :class='result.ok ? "alert-success" : "alert-danger"'
            >
                <div v-if='result.ok'>
                    Subject submitted — person involved id
                    <strong>{{ result.personInvolvedId }}</strong>
                    on incident {{ selectedIncident?.id }}.
                    <div
                        v-if='result.note'
                        class='mt-1 text-muted'
                    >
                        {{ result.note }}
                    </div>
                </div>
                <div v-else>
                    <strong>Submit failed.</strong> {{ result.message }}
                    <div
                        v-if='result.hint'
                        class='mt-1 text-muted'
                    >
                        {{ result.hint }}
                    </div>
                    <details
                        v-if='result.apiBody || result.payload'
                        class='mt-2'
                    >
                        <summary class='text-muted'>
                            Technical details
                        </summary>
                        <div
                            v-if='result.payload'
                            class='mt-2'
                        >
                            <div class='fw-semibold'>
                                Request payload
                            </div>
                            <pre class='small mb-0' style='white-space:pre-wrap'>{{ result.payload }}</pre>
                        </div>
                        <div
                            v-if='result.apiBody'
                            class='mt-2'
                        >
                            <div class='fw-semibold'>
                                D4H response
                            </div>
                            <pre class='small mb-0' style='white-space:pre-wrap'>{{ result.apiBody }}</pre>
                        </div>
                    </details>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { loadConfig, type D4HConfig } from '../lib/d4h-config.ts';
import type { D4HIncident, D4HRoster } from '../lib/d4h-types.ts';
import { loadSubjectsFromMission } from '../lib/mission-subjects.ts';
import {
    displaySubjectNumber,
    calculateAgeFromDateOfBirth,
    type ParsedSubject,
} from '../lib/subject-info.ts';
import {
    involvedPersonFormFromSubject,
    buildInvolvedPersonPayload,
    blankInvolvedPersonForm,
    type InvolvedPersonFormState,
} from '../lib/subject-d4h-map.ts';
import {
    D4H_SEX_OPTIONS as SEX_OPTIONS,
    D4H_AREA_KNOWLEDGE_OPTIONS as AREA_KNOWLEDGE_OPTIONS,
    D4H_CAUSE_OPTIONS as CAUSE_OPTIONS,
    D4H_HANDOVER_OPTIONS as HANDOVER_OPTIONS,
    D4H_SPINAL_INJURY_OPTIONS as SPINAL_INJURY_OPTIONS,
    D4H_TRANSFER_OPTIONS as TRANSFER_OPTIONS,
    D4H_NATIONALITY_OPTIONS as NATIONALITY_OPTIONS,
} from '../lib/d4h-involved-enums.ts';
import {
    fetchIncidentInvolvedMetadata,
    listPersonInvolvedCustomFields,
    createIncidentInvolvedPerson,
    type D4HCustomField,
    type D4HCustomFieldType,
    type D4HInvolvementType,
    type D4HInvolvedOutcome,
} from '../lib/d4h-client.ts';
import { formatD4hWriteError, formatD4hErrorBody, isMalformedRequestError } from '../lib/d4h-errors.ts';
import { buildD4hCustomFieldValues, cfValueIsEmpty, mandatoryCustomFieldsNotBuilt } from '../lib/d4h-custom-field-values.ts';
import { useMapStore } from '../../../src/stores/map.ts';
import { db } from '../../../src/database.ts';

interface MissionRef { guid: string; name: string }

const props = defineProps<{
    roster?: D4HRoster | null;
}>();

const config = ref<D4HConfig | null>(null);
const missions = ref<MissionRef[]>([]);
const selectedIncidentId = ref<number | undefined>(undefined);
const selectedMissionGuid = ref<string | undefined>(undefined);
const linkedMissionGuid = ref<string | undefined>(undefined);

const subjects = ref<ParsedSubject[]>([]);
const subjectsLoaded = ref(false);
const loadingSubjects = ref(false);
const selectedSubjectCaseId = ref('');
const loadError = ref<string | null>(null);

const involvementTypes = ref<D4HInvolvementType[]>([]);
const outcomes = ref<D4HInvolvedOutcome[]>([]);
const metadataLoaded = ref(false);
const metadataLoading = ref(false);

const customFields = ref<D4HCustomField[]>([]);
const cfLoading = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cfValues = reactive<Record<number, any>>({});

const form = reactive<InvolvedPersonFormState>(blankInvolvedPersonForm());

const submitting = ref(false);
const result = ref<
    | { ok: true; personInvolvedId: unknown; note?: string }
    | { ok: false; message: string; hint?: string; apiBody?: string; payload?: string }
    | null
>(null);

const incidentOptions = computed(() => {
    const list = props.roster?.incidents ?? [];
    return [...list]
        .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))
        .map((inc) => ({
            id: inc.id,
            label: `${inc.reference ?? inc.id} — ${inc.title}${inc.published ? ' (published)' : ''}`,
        }));
});

const selectedIncident = computed(() => {
    const id = selectedIncidentId.value;
    if (id == null) return null;
    return props.roster?.incidents?.find((i) => i.id === id) ?? null;
});

const filteredOutcomes = computed(() => {
    if (form.involvementTypeId === '') return [];
    const typeId = Number(form.involvementTypeId);
    return outcomes.value.filter((o) => o.involvementTypeId === typeId);
});

function inputTypeFor(t: D4HCustomFieldType): string {
    switch (t) {
        case 'NUMBER':   return 'number';
        case 'DATE':     return 'date';
        case 'DATETIME': return 'datetime-local';
        case 'TIME':     return 'time';
        default:         return 'text';
    }
}

const missingMandatory = computed(() =>
    customFields.value.filter((f) => f.mandatory && cfValueIsEmpty(f, cfValues[f.id])).map((f) => f.title),
);

const outcomeRequired = computed(() => filteredOutcomes.value.length > 0);

const invalidMandatoryCustom = computed(() => {
    const built = buildD4hCustomFieldValues(customFields.value, cfValues);
    return mandatoryCustomFieldsNotBuilt(customFields.value, cfValues, built);
});

const outcomeValid = computed(() => {
    if (!outcomeRequired.value) return true;
    const id = Number(form.outcomeId);
    return Number.isFinite(id) && filteredOutcomes.value.some((o) => o.id === id);
});

const canSubmit = computed(() =>
    !!config.value
    && config.value.context === 'team'
    && !!selectedIncident.value
    && selectedIncident.value.published !== true
    && form.name.trim().length > 0
    && form.involvementTypeId !== ''
    && outcomeValid.value
    && missingMandatory.value.length === 0
    && invalidMandatoryCustom.value.length === 0,
);

function applyIncidentMissionLink(inc: D4HIncident | null): void {
    linkedMissionGuid.value = inc?.missionGuid;
    if (inc?.missionGuid) selectedMissionGuid.value = inc.missionGuid;
}

function applySelectedSubject(): void {
    const s = subjects.value.find((x) => x.subjectCaseID === selectedSubjectCaseId.value);
    if (!s) return;
    Object.assign(form, involvedPersonFormFromSubject(s));
}

function onDobChange(): void {
    if (!form.dateOfBirth) return;
    const age = calculateAgeFromDateOfBirth(form.dateOfBirth);
    if (age) form.age = age;
}

async function loadMetadata(): Promise<void> {
    if (!config.value) return;
    metadataLoading.value = true;
    try {
        const meta = await fetchIncidentInvolvedMetadata(config.value);
        involvementTypes.value = meta.involvementTypes;
        outcomes.value = meta.outcomes;
        metadataLoaded.value = true;
    } catch (e) {
        loadError.value = `Metadata load failed: ${(e as Error).message}`;
    } finally {
        metadataLoading.value = false;
    }
}

async function loadCustomFields(): Promise<void> {
    if (!config.value) return;
    cfLoading.value = true;
    try {
        customFields.value = await listPersonInvolvedCustomFields(config.value);
        for (const f of customFields.value) {
            cfValues[f.id] = f.type === 'MULTIPLE_CHOICE' ? [] : '';
        }
    } catch (e) {
        console.warn('[d4h] person-involved custom fields:', (e as Error).message);
    } finally {
        cfLoading.value = false;
    }
}

async function loadSubjects(): Promise<void> {
    loadError.value = null;
    subjectsLoaded.value = false;
    subjects.value = [];
    selectedSubjectCaseId.value = '';

    const guid = selectedMissionGuid.value;
    if (!guid) return;

    loadingSubjects.value = true;
    try {
        const loaded = await loadSubjectsFromMission(guid);
        subjects.value = loaded.subjects;
        subjectsLoaded.value = true;
        if (loaded.subjects.length) {
            selectedSubjectCaseId.value = loaded.subjects[0].subjectCaseID;
            applySelectedSubject();
        } else {
            Object.assign(form, blankInvolvedPersonForm());
        }
    } catch (e) {
        loadError.value = (e as Error).message;
    } finally {
        loadingSubjects.value = false;
    }
}

async function onSubmit(): Promise<void> {
    const inc = selectedIncident.value;
    if (!config.value || !inc || form.involvementTypeId === '') return;

    submitting.value = true;
    result.value = null;

    const customVals = buildD4hCustomFieldValues(customFields.value, cfValues);
    const payload = buildInvolvedPersonPayload(inc.id, form, customVals, {
        outcomes: outcomes.value,
    });
    const payloadText = JSON.stringify(payload, null, 2);

    try {
        const created = await createIncidentInvolvedPerson(config.value, payload);
        const personInvolvedId = created.id ?? created.personInvolvedId ?? '(unknown)';
        result.value = { ok: true, personInvolvedId };
    } catch (e) {
        let err = e as Error & { status?: number; body?: unknown };

        if (isMalformedRequestError(err) && payload.customFieldValues?.length) {
            try {
                const fallback = buildInvolvedPersonPayload(inc.id, form, [], {
                    outcomes: outcomes.value,
                });
                const created = await createIncidentInvolvedPerson(config.value, fallback);
                const personInvolvedId = created.id ?? created.personInvolvedId ?? '(unknown)';
                result.value = {
                    ok: true,
                    personInvolvedId,
                    note: 'Submitted without custom fields — D4H rejected one or more custom field values. '
                        + 'Check field formats (date/time/number) in Team Manager.',
                };
                return;
            } catch (retryErr) {
                err = retryErr as Error & { status?: number; body?: unknown };
            }
        }

        result.value = {
            ok: false,
            message: formatD4hWriteError(err),
            hint: err.status === 401 || err.status === 403
                ? 'Confirm the API token has write scope for persons involved.'
                : inc.published === true
                    ? 'This incident is published — try an unpublished incident.'
                    : undefined,
            apiBody: formatD4hErrorBody(err) || undefined,
            payload: payloadText,
        };
    } finally {
        submitting.value = false;
    }
}

onMounted(async () => {
    config.value = await loadConfig();

    if (props.roster?.incidents?.length && !selectedIncidentId.value) {
        const sorted = [...props.roster.incidents].sort(
            (a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''),
        );
        selectedIncidentId.value = sorted[0]?.id;
    }
    applyIncidentMissionLink(selectedIncident.value);

    const mapStore = useMapStore();
    const subs = await db.subscription.toArray();
    missions.value = subs
        .map((s) => ({ guid: s.guid, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!selectedMissionGuid.value) {
        selectedMissionGuid.value = linkedMissionGuid.value
            ?? mapStore.mission?.guid
            ?? missions.value[0]?.guid;
    }

    await Promise.all([loadMetadata(), loadCustomFields(), loadSubjects()]);
});

watch(() => props.roster, (r) => {
    if (!selectedIncidentId.value && r?.incidents?.length) {
        const sorted = [...r.incidents].sort(
            (a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''),
        );
        selectedIncidentId.value = sorted[0]?.id;
    }
    applyIncidentMissionLink(selectedIncident.value);
}, { deep: true });

watch(selectedIncident, (inc) => {
    if (inc?.missionGuid && inc.missionGuid !== selectedMissionGuid.value) {
        selectedMissionGuid.value = inc.missionGuid;
        void loadSubjects();
    }
});
</script>
