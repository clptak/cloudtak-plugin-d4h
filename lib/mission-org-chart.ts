// Load the incident-manager org chart from a DataSync mission schema file.
// Dual-sync incidents store the schema on `{name} - MGMT` as `*_DataSync.json`.

import Subscription from '../../../src/base/subscription.ts';
import { server } from '../../../src/std.ts';
import { db } from '../../../src/database.ts';
import {
    collectD4hMemberIds,
    orgChartFromSchemaValue,
    orgChartHasContent,
    type OrgChartTree,
} from './org-chart-members.ts';

const MISSION_SCHEMA_FILENAME = 'mission_schema.json';
const MISSION_SCHEMA_SUFFIX = '_DataSync.json';
const MGMT_SUFFIX = ' - MGMT';
const SESSION_MISSION_KEY = 'incident-manager:active-mission';

interface ContentLike {
    hash?: string;
    name?: string;
    submissionTime?: string;
}

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

interface SchemaMissionRef {
    guid: string;
    name: string;
    token?: string;
}

function isMissionSchemaContentName(name: string | undefined): boolean {
    if (name?.endsWith(MISSION_SCHEMA_SUFFIX)) return true;
    if (!name) return false;
    return name === MISSION_SCHEMA_FILENAME
        || name.endsWith(`/${MISSION_SCHEMA_FILENAME}`)
        || name.endsWith(MISSION_SCHEMA_FILENAME);
}

function findLatestSchemaContent(contents: ContentLike[]): ContentLike | null {
    const matches = contents.filter(
        (c) => isMissionSchemaContentName(c.name) && c.hash,
    );
    if (!matches.length) return null;
    matches.sort(
        (a, b) => Date.parse(b.submissionTime || '') - Date.parse(a.submissionTime || ''),
    );
    return matches[0];
}

function isMgmtMissionName(name: string): boolean {
    return name.endsWith(MGMT_SUFFIX);
}

function readSessionMission(): SessionMission | null {
    try {
        const raw = sessionStorage.getItem(SESSION_MISSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as SessionMission;
    } catch {
        return null;
    }
}

async function fetchMissionFileText(hash: string, name: string): Promise<string> {
    const res = await server.GET('/api/marti/api/files/{:hash}', {
        params: {
            path: { ':hash': hash },
            query: { name },
        },
        parseAs: 'text',
    });
    if (res.error) throw new Error(res.error.message);
    return res.data;
}

async function fetchMissionByName(name: string): Promise<SchemaMissionRef | null> {
    try {
        const res = await server.GET('/api/marti/missions/{:name}', {
            params: {
                path: { ':name': name },
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

/** Mission token from Dexie subscription row or incident-manager session storage. */
async function missionTokenForGuid(guid: string): Promise<string | undefined> {
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

/**
 * Dual-sync incidents keep mission_schema / *_DataSync.json on `{name} - MGMT`.
 * Fall back to the selected mission when no sibling is visible (pre-Phase-1).
 */
async function resolveSchemaMission(selectedGuid: string): Promise<SchemaMissionRef> {
    const row = await db.subscription.get(selectedGuid);
    const selectedName = row?.name ?? selectedGuid;
    const selected: SchemaMissionRef = {
        guid: selectedGuid,
        name: selectedName,
        token: await missionTokenForGuid(selectedGuid),
    };

    if (isMgmtMissionName(selectedName)) return selected;

    const session = readSessionMission();
    const sessionMgmtGuid = session?.mgmt?.guid;
    if (
        sessionMgmtGuid
        && (session.guid === selectedGuid || sessionMgmtGuid === selectedGuid)
    ) {
        const mgmtName = session.mgmt?.name || `${selectedName}${MGMT_SUFFIX}`;
        return {
            guid: sessionMgmtGuid,
            name: mgmtName,
            token: session.mgmt?.missionToken?.trim()
                || await missionTokenForGuid(sessionMgmtGuid),
        };
    }

    const mgmtName = `${selectedName}${MGMT_SUFFIX}`;
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

export type OrgChartEmptyReason = 'no-file' | 'empty-chart' | 'no-member-ids';

export interface LoadedOrgChart {
    tree: OrgChartTree;
    missionGuid: string;
    missionName: string;
    schemaFileName?: string;
    emptyReason?: OrgChartEmptyReason;
}

/**
 * Read `assignments_org_chart` from the latest schema file on the management
 * DataSync when present (legacy `mission_schema.json` or `*_DataSync.json`).
 * Returns an empty tree when the file or field is missing.
 */
export async function loadOrgChartFromMission(missionGuid: string): Promise<LoadedOrgChart> {
    const schemaMission = await resolveSchemaMission(missionGuid);
    const missionToken = schemaMission.token || await missionTokenForGuid(schemaMission.guid);

    const sub = await Subscription.load(schemaMission.guid, {
        missiontoken: missionToken,
        subscribed: true,
    });
    if (sub.fetch) await sub.fetch();

    const contents = await sub.contents.list();
    const content = findLatestSchemaContent(contents);
    if (!content?.hash) {
        return {
            tree: {},
            missionGuid: schemaMission.guid,
            missionName: schemaMission.name,
            emptyReason: 'no-file',
        };
    }

    const schemaFileName = content.name || MISSION_SCHEMA_FILENAME;
    const text = await fetchMissionFileText(content.hash, schemaFileName);
    const schema = JSON.parse(text) as { assignments_org_chart?: unknown };
    const tree = orgChartFromSchemaValue(schema.assignments_org_chart);

    let emptyReason: OrgChartEmptyReason | undefined;
    if (!orgChartHasContent(tree)) emptyReason = 'empty-chart';
    else if (!collectD4hMemberIds(tree).length) emptyReason = 'no-member-ids';

    return {
        tree,
        missionGuid: schemaMission.guid,
        missionName: schemaMission.name,
        schemaFileName,
        emptyReason,
    };
}
