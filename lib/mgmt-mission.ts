// Resolve the incident's management DataSync (`{name} - MGMT`) and its mission
// token. incident-manager keeps planning data (org chart, subjects) there as
// TAK Mission Properties; see lib/mission-properties.ts.

import { server } from '../../../src/std.ts';
import { db } from '../../../src/database.ts';

export const MGMT_SUFFIX = ' - MGMT';
const SESSION_MISSION_KEY = 'incident-manager:active-mission';

interface SessionMgmt {
    guid?: string;
    name?: string;
    missionToken?: string;
}

interface SessionMission {
    guid?: string;
    name?: string;
    missionToken?: string;
    token?: string;
    mgmt?: SessionMgmt;
}

export interface MissionRef {
    guid: string;
    name: string;
    token?: string;
}

function isMgmtMissionName(name: string): boolean {
    return name.endsWith(MGMT_SUFFIX);
}

/** incident-manager's active mission (same tab only). */
function readSessionMission(): SessionMission | null {
    try {
        const raw = sessionStorage.getItem(SESSION_MISSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as SessionMission;
    } catch {
        return null;
    }
}

async function fetchMissionByName(name: string): Promise<MissionRef | null> {
    try {
        const res = await server.GET('/api/marti/missions/{:guid}', {
            params: {
                path: { ':guid': name },
                query: { changes: false, logs: false },
            },
        });
        if (res.error) return null;
        const data = res.data as { guid?: string; name?: string; token?: string } | undefined;
        if (!data?.guid) return null;
        return {
            guid: data.guid,
            name: data.name || name,
            token: typeof data.token === 'string' ? data.token.trim() || undefined : undefined,
        };
    } catch {
        return null;
    }
}

/** Mission token from the Dexie subscription row or incident-manager session storage. */
export async function missionTokenForGuid(guid: string): Promise<string | undefined> {
    const row = await db.subscription.get(guid);
    if (row?.token?.trim()) return row.token.trim();

    const parsed = readSessionMission();
    if (!parsed) return undefined;
    if (parsed.guid === guid) {
        return parsed.missionToken?.trim() || parsed.token?.trim() || undefined;
    }
    if (parsed.mgmt?.guid === guid) {
        return parsed.mgmt.missionToken?.trim() || undefined;
    }
    return undefined;
}

/** The selected mission itself (name + token). */
export async function selectedMission(selectedGuid: string): Promise<MissionRef> {
    const row = await db.subscription.get(selectedGuid);
    return {
        guid: selectedGuid,
        name: row?.name ?? selectedGuid,
        token: await missionTokenForGuid(selectedGuid),
    };
}

/**
 * The management DataSync for the selected incident mission.
 * Order: selected mission is already MGMT → incident-manager session →
 * subscribed `{name} - MGMT` → Marti lookup by name. Falls back to the
 * selected mission for single-sync incidents created before the MGMT split.
 */
export async function resolveMgmtMission(selectedGuid: string): Promise<MissionRef> {
    const selected = await selectedMission(selectedGuid);
    if (isMgmtMissionName(selected.name)) return selected;

    const session = readSessionMission();
    const sessionMgmtGuid = session?.mgmt?.guid;
    if (
        session
        && sessionMgmtGuid
        && (session.guid === selectedGuid || sessionMgmtGuid === selectedGuid)
    ) {
        return {
            guid: sessionMgmtGuid,
            name: session.mgmt?.name || `${selected.name}${MGMT_SUFFIX}`,
            token: session.mgmt?.missionToken?.trim()
                || await missionTokenForGuid(sessionMgmtGuid),
        };
    }

    const mgmtName = `${selected.name}${MGMT_SUFFIX}`;
    const subs = await db.subscription.toArray();
    const dexieMgmt = subs.find((s) => s.name === mgmtName);
    if (dexieMgmt?.guid) {
        return {
            guid: dexieMgmt.guid,
            name: dexieMgmt.name,
            token: dexieMgmt.token?.trim() || await missionTokenForGuid(dexieMgmt.guid),
        };
    }

    const marti = await fetchMissionByName(mgmtName);
    if (marti) {
        return {
            guid: marti.guid,
            name: marti.name,
            token: marti.token || await missionTokenForGuid(marti.guid),
        };
    }

    return selected;
}
