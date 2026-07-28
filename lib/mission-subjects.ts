// Load subject-information logs from a DataSync mission (incident-manager Logger tab).

import Subscription from '../../../src/base/subscription.ts';
import { db } from '../../../src/database.ts';
import { parseSubjectsFromLogs, type ParsedSubject } from './subject-info.ts';

async function missionTokenForGuid(guid: string): Promise<string | undefined> {
    const row = await db.subscription.get(guid);
    if (row?.token?.trim()) return row.token.trim();

    try {
        const raw = sessionStorage.getItem('incident-manager:active-mission');
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as { guid?: string; missionToken?: string; token?: string };
        if (parsed.guid !== guid) return undefined;
        return parsed.missionToken?.trim() || parsed.token?.trim() || undefined;
    } catch {
        return undefined;
    }
}

export interface LoadedMissionSubjects {
    subjects: ParsedSubject[];
    missionGuid: string;
    missionName: string;
}

export async function loadSubjectsFromMission(missionGuid: string): Promise<LoadedMissionSubjects> {
    const row = await db.subscription.get(missionGuid);
    const missionName = row?.name ?? missionGuid;
    const missionToken = await missionTokenForGuid(missionGuid);

    const sub = await Subscription.load(missionGuid, {
        missiontoken: missionToken,
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

    return { subjects, missionGuid, missionName };
}
