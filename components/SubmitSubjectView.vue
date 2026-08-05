<template>
    <div class='d-flex flex-column'>
        <h5 class='mb-3'>
            Submit Subject To D4H
        </h5>

        <TablerInlineAlert
            v-if='!config'
            severity='warning'
            title='D4H Not Configured'
            description='Open the connection settings and run Test Connection first.'
        />

        <template v-else>
            <TablerBorder
                class='cloudtak-accent text-white'
                :fill-height='false'
                :shadow='false'
                gap='sm'
            >
                <TablerEnum
                    v-model='incidentSelection'
                    label='Incident'
                    description='From last sync.'
                    :options='incidentOptionsOrPlaceholder'
                    :disabled='!incidentOptions.length'
                />
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

                <TablerEnum
                    v-model='missionSelection'
                    label='DataSync Mission'
                    description='Subject information source.'
                    :options='missionOptionsOrPlaceholder'
                    :disabled='!missions.length'
                />

                <div class='d-flex gap-2 flex-wrap align-items-end'>
                    <div
                        class='flex-grow-1'
                        style='max-width:16rem'
                    >
                        <TablerEnum
                            v-model='subjectSelection'
                            label='Subject'
                            :options='subjectOptionsOrPlaceholder'
                            :disabled='!subjects.length'
                        />
                    </div>
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
                        {{ loadingSubjects ? 'Loading…' : 'Reload Subjects' }}
                    </button>
                </div>

                <TablerInlineAlert
                    v-if='loadError'
                    severity='danger'
                    title='Load Failed'
                    :description='loadError'
                />
                <TablerInlineAlert
                    v-else-if='subjectsLoaded && !subjects.length'
                    severity='warning'
                    title='No Subject Logs'
                    description='No subject-information logs on this mission. Enter subject details in the incident-manager Logger → Subject Information tab first.'
                />

                <TablerInlineAlert
                    v-if='selectedIncident?.published === true'
                    severity='warning'
                    title='Incident Published'
                    description='Person-involved writes may be rejected after publish. Use an unpublished incident or unpublish in D4H Team Manager.'
                />

                <form
                    v-if='metadataLoaded'
                    @submit.prevent='onSubmit'
                >
                    <p class='text-uppercase text-white-50 small mb-2'>
                        Person Involved
                    </p>

                    <div class='row g-2 mb-2'>
                        <div class='col-md-6'>
                            <TablerInput
                                v-model='form.name'
                                label='Name'
                            />
                        </div>
                        <div class='col-md-3'>
                            <TablerInput
                                v-model='form.dateOfBirth'
                                type='date'
                                label='Date Of Birth'
                            />
                        </div>
                        <div class='col-md-3'>
                            <TablerInput
                                v-model='form.age'
                                label='Age'
                                :disabled='!!form.dateOfBirth'
                            />
                        </div>
                    </div>

                    <div class='row g-2 mb-2'>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='sexSelection'
                                label='Sex'
                                :options='sexOptions'
                            />
                        </div>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='involvementTypeSelection'
                                label='Involvement Type'
                                :options='involvementTypeOptions'
                                :required='true'
                            />
                        </div>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='outcomeSelection'
                                label='Outcome'
                                :options='outcomeOptions'
                                :disabled='!filteredOutcomes.length'
                                :required='outcomeRequired'
                            />
                        </div>
                    </div>

                    <div class='row g-2 mb-2'>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='nationalitySelection'
                                label='Nationality'
                                :options='nationalityOptions'
                            />
                        </div>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='areaKnowledgeSelection'
                                label='Area Knowledge'
                                :options='areaKnowledgeOptions'
                            />
                        </div>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='causeSelection'
                                label='Cause'
                                :options='causeOptions'
                            />
                        </div>
                    </div>

                    <div class='row g-2 mb-2'>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='handoverSelection'
                                label='Handover'
                                :options='handoverOptions'
                            />
                        </div>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='spinalInjurySelection'
                                label='Spinal Injury'
                                :options='spinalInjuryOptions'
                            />
                        </div>
                        <div class='col-md-4'>
                            <TablerEnum
                                v-model='transferSelection'
                                label='Transfer'
                                :options='transferOptions'
                            />
                        </div>
                    </div>

                    <div class='row g-2 mb-2'>
                        <div class='col-md-6'>
                            <TablerInput
                                v-model='form.assistance'
                                label='Assistance'
                            />
                        </div>
                        <div class='col-md-6'>
                            <TablerInput
                                v-model='form.contact'
                                label='Contact'
                            />
                        </div>
                    </div>

                    <TablerInput
                        v-model='form.involvementNotes'
                        :rows='4'
                        label='Involvement Notes'
                        placeholder='Pre-filled from mission subject details that have no direct D4H field'
                    />

                    <div
                        v-if='cfLoading'
                        class='text-muted small mt-2'
                    >
                        Loading custom fields…
                    </div>

                    <TablerBorder
                        v-else-if='customFields.length'
                        class='cloudtak-accent text-white mt-2'
                        :fill-height='false'
                        :shadow='false'
                        gap='sm'
                    >
                        <template #label>
                            <p class='text-uppercase text-white-50 small mb-0'>
                                Custom Fields
                            </p>
                        </template>

                        <template
                            v-for='f in customFields'
                            :key='f.id'
                        >
                            <TablerInput
                                v-if='f.type === "TEXT_AREA"'
                                :model-value='cfValues[f.id]'
                                :rows='3'
                                :label='f.title'
                                :description='f.hint'
                                :required='f.mandatory'
                                @update:model-value='(v: string | number) => { cfValues[f.id] = v; }'
                            />
                            <TablerEnum
                                v-else-if='f.type === "SINGLE_CHOICE"'
                                :model-value='customChoiceLabel(f)'
                                :label='f.title'
                                :description='f.hint'
                                :required='f.mandatory'
                                :options='customChoiceOptions(f)'
                                @update:model-value='(v: string) => setCustomChoice(f, v)'
                            />
                            <div
                                v-else-if='f.type === "MULTIPLE_CHOICE"'
                                class='mb-2'
                            >
                                <label class='small text-white-50 mb-1 d-block'>
                                    {{ f.title }}
                                    <span
                                        v-if='f.mandatory'
                                        class='text-danger'
                                    >*</span>
                                </label>
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
                                <div
                                    v-if='f.hint'
                                    class='form-text small'
                                >
                                    {{ f.hint }}
                                </div>
                            </div>
                            <TablerInput
                                v-else
                                :model-value='cfValues[f.id]'
                                :type='inputTypeFor(f.type)'
                                :label='f.title'
                                :description='f.hint'
                                :required='f.mandatory'
                                @update:model-value='(v: string | number) => { cfValues[f.id] = v; }'
                            />
                        </template>
                    </TablerBorder>

                    <TablerInlineAlert
                        v-if='showValidationAlert'
                        class='mt-2'
                        severity='danger'
                        title='Fix Before Submitting'
                        :description='validationMessage'
                    />

                    <button
                        type='submit'
                        class='btn btn-primary w-100 mt-2'
                        :disabled='submitting || !canSubmit'
                    >
                        <span
                            v-if='submitting'
                            class='spinner-border spinner-border-sm me-1'
                        />
                        {{ submitting ? 'Submitting…' : 'Submit Subject' }}
                    </button>
                </form>

                <div
                    v-else-if='metadataLoading'
                    class='text-muted small'
                >
                    Loading D4H involved-person metadata…
                </div>
            </TablerBorder>

            <template v-if='result'>
                <TablerInlineAlert
                    class='mt-3'
                    :severity='result.ok ? "success" : "danger"'
                    :title='result.ok ? "Subject Submitted" : "Submit Failed"'
                    :description='resultDescription'
                />

                <template v-if='!result.ok'>
                    <details
                        v-if='result.apiBody || result.payload'
                        class='mt-2'
                    >
                        <summary class='text-muted small'>
                            Technical Details
                        </summary>
                        <div
                            v-if='result.payload'
                            class='mt-2'
                        >
                            <div class='fw-semibold small'>
                                Request Payload
                            </div>
                            <pre
                                class='small mb-0'
                                style='white-space:pre-wrap'
                            >{{ result.payload }}</pre>
                        </div>
                        <div
                            v-if='result.apiBody'
                            class='mt-2'
                        >
                            <div class='fw-semibold small'>
                                D4H Response
                            </div>
                            <pre
                                class='small mb-0'
                                style='white-space:pre-wrap'
                            >{{ result.apiBody }}</pre>
                        </div>
                    </details>
                </template>
            </template>
        </template>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { TablerBorder, TablerInput, TablerEnum, TablerInlineAlert } from '@tak-ps/vue-tabler';
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

const incidentOptionsOrPlaceholder = computed(() => (
    incidentOptions.value.length
        ? incidentOptions.value.map((o) => o.label)
        : ['No incidents — run Sync now']
));

const incidentSelection = computed<string>({
    get: () => incidentOptions.value.find((o) => o.id === selectedIncidentId.value)?.label
        ?? incidentOptionsOrPlaceholder.value[0],
    set: (label) => {
        selectedIncidentId.value = incidentOptions.value.find((o) => o.label === label)?.id;
    },
});

interface MissionOption { guid: string; label: string }

const missionOptionsList = computed<MissionOption[]>(() => (
    missions.value.map((m) => ({
        guid: m.guid,
        label: `${m.name}${m.guid === linkedMissionGuid.value ? ' (linked)' : ''}`,
    }))
));

const missionOptionsOrPlaceholder = computed(() => (
    missionOptionsList.value.length
        ? missionOptionsList.value.map((o) => o.label)
        : ['No loaded missions']
));

const missionSelection = computed<string>({
    get: () => missionOptionsList.value.find((o) => o.guid === selectedMissionGuid.value)?.label
        ?? missionOptionsOrPlaceholder.value[0],
    set: (label) => {
        selectedMissionGuid.value = missionOptionsList.value.find((o) => o.label === label)?.guid;
        void loadSubjects();
    },
});

interface SubjectOption { id: string; label: string }

const subjectOptionsList = computed<SubjectOption[]>(() => (
    subjects.value.map((s) => ({
        id: s.subjectCaseID,
        label: `Subject ${displaySubjectNumber(s.subjectCaseID)}${s.subjectName ? ` — ${s.subjectName}` : ''}`,
    }))
));

const subjectOptionsOrPlaceholder = computed(() => (
    subjectOptionsList.value.length
        ? subjectOptionsList.value.map((o) => o.label)
        : ['No subjects in mission']
));

const subjectSelection = computed<string>({
    get: () => subjectOptionsList.value.find((o) => o.id === selectedSubjectCaseId.value)?.label
        ?? subjectOptionsOrPlaceholder.value[0],
    set: (label) => {
        selectedSubjectCaseId.value = subjectOptionsList.value.find((o) => o.label === label)?.id ?? '';
        applySelectedSubject();
    },
});

const involvementTypeOptions = computed(() => ['Select type…', ...involvementTypes.value.map((t) => t.title)]);

const involvementTypeSelection = computed<string>({
    get: () => involvementTypes.value.find((t) => t.id === form.involvementTypeId)?.title
        ?? involvementTypeOptions.value[0],
    set: (title) => {
        form.involvementTypeId = involvementTypes.value.find((t) => t.title === title)?.id ?? '';
        form.outcomeId = '';
    },
});

const outcomeOptions = computed(() => ['—', ...filteredOutcomes.value.map((o) => o.title)]);

const outcomeSelection = computed<string>({
    get: () => filteredOutcomes.value.find((o) => o.id === form.outcomeId)?.title
        ?? outcomeOptions.value[0],
    set: (title) => {
        form.outcomeId = filteredOutcomes.value.find((o) => o.title === title)?.id ?? '';
    },
});

type EnumFormField = 'sex' | 'nationality' | 'areaKnowledge' | 'cause' | 'handover' | 'spinalInjury' | 'transfer';

function makeEnumSelection(field: EnumFormField, options: ReadonlyArray<{ value: string; label: string }>) {
    return computed<string>({
        get: () => options.find((o) => o.value === form[field])?.label ?? '—',
        set: (label: string) => {
            form[field] = options.find((o) => o.label === label)?.value ?? '';
        },
    });
}

const sexOptions = ['—', ...SEX_OPTIONS.map((o) => o.label)];
const nationalityOptions = ['—', ...NATIONALITY_OPTIONS.map((o) => o.label)];
const areaKnowledgeOptions = ['—', ...AREA_KNOWLEDGE_OPTIONS.map((o) => o.label)];
const causeOptions = ['—', ...CAUSE_OPTIONS.map((o) => o.label)];
const handoverOptions = ['—', ...HANDOVER_OPTIONS.map((o) => o.label)];
const spinalInjuryOptions = ['—', ...SPINAL_INJURY_OPTIONS.map((o) => o.label)];
const transferOptions = ['—', ...TRANSFER_OPTIONS.map((o) => o.label)];

const sexSelection = makeEnumSelection('sex', SEX_OPTIONS);
const nationalitySelection = makeEnumSelection('nationality', NATIONALITY_OPTIONS);
const areaKnowledgeSelection = makeEnumSelection('areaKnowledge', AREA_KNOWLEDGE_OPTIONS);
const causeSelection = makeEnumSelection('cause', CAUSE_OPTIONS);
const handoverSelection = makeEnumSelection('handover', HANDOVER_OPTIONS);
const spinalInjurySelection = makeEnumSelection('spinalInjury', SPINAL_INJURY_OPTIONS);
const transferSelection = makeEnumSelection('transfer', TRANSFER_OPTIONS);

function customChoiceOptions(f: D4HCustomField): string[] {
    return ['—', ...f.options.map((o) => o.label)];
}

function customChoiceLabel(f: D4HCustomField): string {
    return f.options.find((o) => o.id === cfValues[f.id])?.label ?? '—';
}

function setCustomChoice(f: D4HCustomField, label: string): void {
    cfValues[f.id] = f.options.find((o) => o.label === label)?.id;
}

const showValidationAlert = computed(() =>
    missingMandatory.value.length > 0 || !outcomeValid.value || invalidMandatoryCustom.value.length > 0,
);

const validationMessage = computed(() => {
    const lines: string[] = [];

    if (outcomeRequired.value && form.outcomeId === '') {
        lines.push('Outcome is required for the selected involvement type.');
    } else if (!outcomeValid.value) {
        lines.push('Select a valid outcome for the chosen involvement type.');
    }
    if (invalidMandatoryCustom.value.length) {
        lines.push(
            `Custom field${invalidMandatoryCustom.value.length === 1 ? '' : 's'} have invalid format: `
            + invalidMandatoryCustom.value.join(', '),
        );
    }
    if (missingMandatory.value.length) {
        lines.push(
            `Required custom field${missingMandatory.value.length === 1 ? '' : 's'}: `
            + missingMandatory.value.join(', '),
        );
    }

    return lines.join(' ');
});

const resultDescription = computed(() => {
    const r = result.value;
    if (!r) return '';
    if (r.ok) {
        const base = `Person involved id ${r.personInvolvedId} on incident ${selectedIncident.value?.id}.`;
        return r.note ? `${base} ${r.note}` : base;
    }
    return r.hint ? `${r.message} ${r.hint}` : r.message;
});

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

watch(() => form.dateOfBirth, () => {
    onDobChange();
});
</script>
