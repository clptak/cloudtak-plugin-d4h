<template>
    <div class='d-flex flex-column'>
        <TablerInlineAlert
            v-if='!config'
            severity='warning'
            title='D4H connection is not configured yet.'
            description='Open the connection settings and run Test connection first.'
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
                    Submit Roster
                </p>
            </template>

            <div>
                <TablerEnum
                    v-model='incidentEnumModel'
                    label='Incident'
                    :options='incidentEnumOptions'
                    :disabled='!incidentOptions.length'
                />
                <div
                    v-if='!incidentOptions.length'
                    class='form-text small text-white-50'
                >
                    No incidents — run Sync now
                </div>
                <div
                    v-else-if='selectedIncident'
                    class='form-text small text-white-50'
                >
                    Activity ID {{ selectedIncident.id }}
                    <span v-if='selectedIncident.startsAt'>
                        · starts {{ formatDate(selectedIncident.startsAt) }}
                    </span>
                    <span
                        v-if='selectedIncident.published === true'
                        class='badge bg-warning text-dark ms-1'
                    >Published</span>
                </div>
            </div>

            <TablerInlineAlert
                v-if='selectedIncident?.published === true'
                severity='warning'
                title='This incident is published in D4H.'
                description='Attendance cannot be added or changed after publish. Submit the roster before publishing the incident, or unpublish it in D4H Team Manager first.'
            />

            <div>
                <TablerEnum
                    v-model='missionEnumModel'
                    label='DataSync mission'
                    :options='missionEnumOptions'
                    :disabled='!missions.length'
                />
                <div
                    v-if='!missions.length'
                    class='form-text small text-white-50'
                >
                    No loaded missions
                </div>
                <div
                    v-else-if='linkedMissionName'
                    class='form-text small text-white-50'
                >
                    Linked mission for this incident: {{ linkedMissionName }}
                </div>
                <div class='form-text small text-white-50'>
                    Roster is read from the incident-manager Assignments org chart
                    (<code>assignments_org_chart</code> in mission_schema.json).
                </div>
            </div>

            <div class='d-flex gap-2 flex-wrap'>
                <button
                    type='button'
                    class='btn btn-outline-secondary btn-sm'
                    :disabled='!selectedMissionGuid || loadingChart'
                    @click='loadOrgChart'
                >
                    <span
                        v-if='loadingChart'
                        class='spinner-border spinner-border-sm me-1'
                    />
                    {{ loadingChart ? 'Loading…' : 'Reload org chart' }}
                </button>
            </div>

            <TablerInlineAlert
                v-if='chartError'
                severity='danger'
                :title='chartError'
            />
            <TablerInlineAlert
                v-else-if='chartLoaded && !rosterRows.length'
                severity='warning'
                title='No D4H members on the org chart for this mission.'
                description='Add personnel in the incident-manager Assignments tab first.'
            />

            <div v-if='rosterRows.length'>
                <div class='small fw-semibold mb-2'>
                    Roster preview ({{ rosterRows.length }} member{{ rosterRows.length === 1 ? '' : 's' }})
                </div>
                <div class='cloudtak-accent border rounded-3 table-responsive'>
                    <table class='table table-sm table-striped mb-0 small'>
                        <thead>
                            <tr>
                                <th style='width:72px'>
                                    Badge
                                </th>
                                <th>Name</th>
                                <th style='width:72px'>
                                    D4H ID
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for='row in rosterRows'
                                :key='row.memberId'
                            >
                                <td class='font-monospace'>
                                    {{ row.ref || '—' }}
                                </td>
                                <td>{{ row.name }}</td>
                                <td class='font-monospace'>
                                    {{ row.memberId }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <button
                type='button'
                class='btn btn-primary btn-sm align-self-start'
                :disabled='!canSubmit || submitting'
                @click='onSubmit'
            >
                <span
                    v-if='submitting'
                    class='spinner-border spinner-border-sm me-1'
                />
                {{ submitting ? 'Submitting…' : 'Submit roster' }}
            </button>

            <div v-if='result'>
                <TablerInlineAlert
                    :severity='result.ok ? "success" : "danger"'
                    :title='result.ok ? `Roster submitted for activity ${selectedIncident?.id}.` : `Submit failed. ${result.message}`'
                />
                <ul
                    v-if='result.details.length'
                    class='mb-0 mt-2 ps-3 small'
                >
                    <li
                        v-for='(line, i) in result.details'
                        :key='i'
                    >
                        {{ line }}
                    </li>
                </ul>
            </div>
        </TablerBorder>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, ref, watch } from 'vue';
import { TablerBorder, TablerEnum, TablerInlineAlert } from '@tak-ps/vue-tabler';
import { loadConfig, type D4HConfig } from '../lib/d4h-config.ts';
import { loadCachedRoster } from '../lib/d4h-roster.ts';
import type { D4HIncident, D4HMember, D4HRoster } from '../lib/d4h-types.ts';
import { collectD4hMemberIds } from '../lib/org-chart-members.ts';
import { loadOrgChartFromMission } from '../lib/mission-org-chart.ts';
import { submitRosterToActivity } from '../lib/submit-roster.ts';
import { useMapStore } from '../../../src/stores/map.ts';
import { db } from '../../../src/database.ts';

interface MissionRef { guid: string; name: string }

interface RosterRow {
    memberId: number;
    ref?: string;
    name: string;
}

const props = defineProps<{
    roster?: D4HRoster | null;
}>();

const config = ref<D4HConfig | null>(null);
const localRoster = ref<D4HRoster | null>(null);
const missions = ref<MissionRef[]>([]);
const selectedIncidentId = ref<number | undefined>(undefined);
const selectedMissionGuid = ref<string | undefined>(undefined);
const linkedMissionGuid = ref<string | undefined>(undefined);

const loadingChart = ref(false);
const chartLoaded = ref(false);
const chartError = ref<string | null>(null);
const memberIds = ref<number[]>([]);

const submitting = ref(false);
const result = ref<
    | { ok: true; details: string[] }
    | { ok: false; message: string; details: string[] }
    | null
>(null);

const incidentOptions = computed(() => {
    const list = (props.roster ?? localRoster.value)?.incidents ?? [];
    return [...list]
        .sort((a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''))
        .map((inc) => ({
            id: inc.id,
            label: `${inc.reference ?? inc.id} — ${inc.title}${inc.published ? ' (published)' : ''}`,
        }));
});

const incidentEnumOptions = computed(() => incidentOptions.value.map((o) => o.label));
const incidentEnumModel = computed({
    get: () => incidentOptions.value.find((o) => o.id === selectedIncidentId.value)?.label ?? '',
    set: (label: string) => {
        selectedIncidentId.value = incidentOptions.value.find((o) => o.label === label)?.id;
        onIncidentChange();
    },
});

const selectedIncident = computed(() =>
    (props.roster ?? localRoster.value)?.incidents?.find((i) => i.id === selectedIncidentId.value) ?? null,
);

const missionEnumOptions = computed(() => missions.value.map((m) => m.name));
const missionEnumModel = computed({
    get: () => missions.value.find((m) => m.guid === selectedMissionGuid.value)?.name ?? '',
    set: (name: string) => {
        selectedMissionGuid.value = missions.value.find((m) => m.name === name)?.guid;
        void loadOrgChart();
    },
});

const linkedMissionName = computed(() =>
    missions.value.find((m) => m.guid === linkedMissionGuid.value)?.name,
);

const memberById = computed(() => {
    const map = new Map<number, D4HMember>();
    for (const m of (props.roster ?? localRoster.value)?.members ?? []) map.set(m.id, m);
    return map;
});

const rosterRows = computed((): RosterRow[] =>
    memberIds.value.map((memberId) => {
        const m = memberById.value.get(memberId);
        return {
            memberId,
            ref: m?.ref,
            name: m?.name ?? `Member ${memberId}`,
        };
    }),
);

const canSubmit = computed(() =>
    !!config.value
    && config.value.context === 'team'
    && !!selectedIncident.value
    && selectedIncident.value.published !== true
    && !!selectedIncident.value.startsAt
    && rosterRows.value.length > 0,
);

function formatDate(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function applyIncidentMissionLink(inc: D4HIncident | null): void {
    linkedMissionGuid.value = inc?.missionGuid;
    if (inc?.missionGuid) {
        selectedMissionGuid.value = inc.missionGuid;
    }
}

async function refreshRoster(): Promise<void> {
    if (!props.roster) localRoster.value = await loadCachedRoster();
    const rosterData = props.roster ?? localRoster.value;
    if (!selectedIncidentId.value && rosterData?.incidents?.length) {
        const sorted = [...rosterData.incidents].sort(
            (a, b) => (b.startsAt ?? '').localeCompare(a.startsAt ?? ''),
        );
        selectedIncidentId.value = sorted[0]?.id;
    }
    applyIncidentMissionLink(selectedIncident.value);
}

watch(() => props.roster, () => {
    void refreshRoster();
}, { deep: true });

async function loadOrgChart(): Promise<void> {
    chartError.value = null;
    chartLoaded.value = false;
    memberIds.value = [];

    const guid = selectedMissionGuid.value;
    if (!guid) return;

    loadingChart.value = true;
    try {
        const loaded = await loadOrgChartFromMission(guid);
        memberIds.value = collectD4hMemberIds(loaded.tree);
        chartLoaded.value = true;
        if (!memberIds.value.length) {
            chartError.value = null;
        }
    } catch (e) {
        chartError.value = (e as Error).message;
    } finally {
        loadingChart.value = false;
    }
}

function onIncidentChange(): void {
    result.value = null;
    applyIncidentMissionLink(selectedIncident.value);
    void loadOrgChart();
}

async function onSubmit(): Promise<void> {
    const inc = selectedIncident.value;
    if (!config.value || !inc?.startsAt) return;

    submitting.value = true;
    result.value = null;

    try {
        const submitResult = await submitRosterToActivity(config.value, {
            activityId: inc.id,
            memberIds: memberIds.value,
            startsAt: inc.startsAt,
            endsAt: inc.endsAt,
        });

        const details = submitResult.results.map((r) => {
            if (r.error) return `Member ${r.memberId}: ${r.error}`;
            return `Member ${r.memberId}: ${r.action}${r.attendanceId != null ? ` (#${r.attendanceId})` : ''}`;
        });

        if (submitResult.ok) {
            result.value = { ok: true, details };
        } else {
            result.value = {
                ok: false,
                message: submitResult.error ?? 'One or more members failed.',
                details,
            };
        }
    } catch (e) {
        result.value = {
            ok: false,
            message: (e as Error).message,
            details: [],
        };
    } finally {
        submitting.value = false;
    }
}

onMounted(async () => {
    config.value = await loadConfig();
    await refreshRoster();

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

    await loadOrgChart();
});

watch(selectedIncident, (inc) => {
    if (inc?.missionGuid && inc.missionGuid !== selectedMissionGuid.value) {
        selectedMissionGuid.value = inc.missionGuid;
        void loadOrgChart();
    }
});

defineExpose({ refreshRoster });
</script>
