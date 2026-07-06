<template>
    <div class='d-flex flex-column h-100 overflow-auto'>
        <h5 class='mb-3'>
            Submit roster to D4H
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
                    v-model='selectedIncidentId'
                    class='form-select form-select-sm'
                    :disabled='!incidentOptions.length'
                    @change='onIncidentChange'
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

            <div
                v-if='selectedIncident?.published === true'
                class='alert alert-warning py-2 small mb-3'
            >
                This incident is <strong>published</strong> in D4H. Attendance cannot be added or
                changed after publish. Submit the roster <em>before</em> publishing the incident,
                or unpublish it in D4H Team Manager first.
            </div>

            <div class='mb-3'>
                <label class='form-label small fw-semibold'>
                    DataSync mission
                    <span class='text-muted fw-normal'>(org chart source)</span>
                </label>
                <select
                    v-model='selectedMissionGuid'
                    class='form-select form-select-sm'
                    :disabled='!missions.length'
                    @change='loadOrgChart'
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
                <div class='form-text small'>
                    Roster is read from the incident-manager Assignments org chart
                    (<code>assignments_org_chart</code> in mission_schema.json).
                </div>
            </div>

            <div class='d-flex gap-2 flex-wrap mb-3'>
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

            <div
                v-if='chartError'
                class='alert alert-danger py-2 small'
            >
                {{ chartError }}
            </div>

            <div
                v-else-if='chartLoaded && !rosterRows.length'
                class='alert alert-warning py-2 small'
            >
                No D4H members on the org chart for this mission. Add personnel in the
                incident-manager Assignments tab first.
            </div>

            <div
                v-if='rosterRows.length'
                class='mb-3'
            >
                <div class='small fw-semibold mb-2'>
                    Roster preview ({{ rosterRows.length }} member{{ rosterRows.length === 1 ? '' : 's' }})
                </div>
                <div class='table-responsive border rounded'>
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

            <div
                v-if='result'
                class='alert mt-3 small'
                :class='result.ok ? "alert-success" : "alert-danger"'
            >
                <div
                    v-if='result.ok'
                    class='fw-semibold'
                >
                    Roster submitted for activity {{ selectedIncident?.id }}.
                </div>
                <div
                    v-else
                    class='fw-semibold'
                >
                    Submit failed. {{ result.message }}
                </div>
                <ul
                    v-if='result.details.length'
                    class='mb-0 mt-2 ps-3'
                >
                    <li
                        v-for='(line, i) in result.details'
                        :key='i'
                    >
                        {{ line }}
                    </li>
                </ul>
            </div>
        </template>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, ref, watch } from 'vue';
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

const selectedIncident = computed(() =>
    (props.roster ?? localRoster.value)?.incidents?.find((i) => i.id === selectedIncidentId.value) ?? null,
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