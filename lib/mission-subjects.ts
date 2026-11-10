// Load incident-manager subjects (Logger → Subject Information) for subject submit.
//
// TAK Server 5.9+: Mission Property `s.incident-response.subjects` on the
// management DataSync (`{name} - MGMT`).
// Legacy, in order: incident_response.subjects in mission_schema.json on that
// DataSync, then `subject-information` logs on the selected mission.

import Subscription from '../../../src/base/subscription.ts';
import { missionTokenForGuid, resolveMgmtMission, selectedMission } from './mgmt-mission.ts';
import {
    getMissionPropertyJson,
    SUBJECTS_KEY,
    usesMissionProperties,
} from './mission-properties.ts';
import { loadLegacySchemaFile } from './legacy-schema.ts';
import { parseSubjectsFromLogs, subjectsFromSchemaValue, type ParsedSubject } from './subject-info.ts';

export interface LoadedMissionSubjects {
    subjects: ParsedSubject[];
    missionGuid: string;
    missionName: string;
    /** Where the subjects came from: the property key, a legacy file name, or "mission logs". */
    source: string;
}

async function subjectsFromLogs(missionGuid: string): Promise<LoadedMissionSubjects> {
    const mission = await selectedMission(missionGuid);
    const sub = await Subscription.load(mission.guid, {
        missiontoken: mission.token,
        subscribed: true,
    });
    if (sub.fetch) await sub.fetch();

    const logs = await sub.log.list({ refresh: true });
    const subjects = parseSubjectsFromLogs(
        logs.map((log) => ({
            keywords: Array.isArray(log.keywords) ? log.keywords : undefined,
            created: typeof log.created === 'string' ? log.created : undefined,
            dtg: typeof log.dtg === 'string' ? log.dtg : undefined,
        })),
    );
    return { subjects, missionGuid: mission.guid, missionName: mission.name, source: 'mission logs' };
}

export async function loadSubjectsFromMission(missionGuid: string): Promise<LoadedMissionSubjects> {
    const mgmt = await resolveMgmtMission(missionGuid);
    const token = mgmt.token || await missionTokenForGuid(mgmt.guid);

    if (await usesMissionProperties(mgmt.guid, token)) {
        const value = await getMissionPropertyJson<unknown>(mgmt.guid, SUBJECTS_KEY, token);
        return {
            subjects: subjectsFromSchemaValue(value),
            missionGuid: mgmt.guid,
            missionName: mgmt.name,
            source: SUBJECTS_KEY,
        };
    }

    const legacy = await loadLegacySchemaFile({ ...mgmt, token });
    const fromFile = subjectsFromSchemaValue(legacy?.schema.incident_response?.subjects);
    if (legacy && fromFile.length) {
        return {
            subjects: fromFile,
            missionGuid: mgmt.guid,
            missionName: mgmt.name,
            source: legacy.fileName,
        };
    }

    return subjectsFromLogs(missionGuid);
}
