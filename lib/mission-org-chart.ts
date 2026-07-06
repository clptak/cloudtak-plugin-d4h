// Load the incident-manager org chart from a DataSync mission's mission_schema.json.

import { Preferences } from '@capacitor/preferences';
import Subscription from '../../../src/base/subscription.ts';
import { server } from '../../../src/std.ts';
import { db } from '../../../src/database.ts';
import { orgChartFromSchemaValue, type OrgChartTree } from './org-chart-members.ts';

const MISSION_SCHEMA_FILENAME = 'mission_schema.json';

interface ContentLike {
    hash?: string;
    name?: string;
    submissionTime?: string;
}

function isMissionSchemaContentName(name: string | undefined): boolean {
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

async function sessionToken(): Promise<string> {
    const { value } = await Preferences.get({ key: 'token' });
    return value || '';
}

/** Mission token from Dexie subscription row or incident-manager session storage. */
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

export interface LoadedOrgChart {
    tree: OrgChartTree;
    missionGuid: string;
    missionName: string;
}

/**
 * Read `assignments_org_chart` from the latest mission_schema.json on a mission.
 * Returns an empty tree when the file or field is missing.
 */
export async function loadOrgChartFromMission(missionGuid: string): Promise<LoadedOrgChart> {
    const row = await db.subscription.get(missionGuid);
    const missionName = row?.name ?? missionGuid;
    const missionToken = await missionTokenForGuid(missionGuid);

    const sub = await Subscription.load(missionGuid, {
        token: await sessionToken(),
        missiontoken: missionToken,
        subscribed: true,
    });
    if (sub.fetch) await sub.fetch();

    const contents = await sub.contents.list();
    const content = findLatestSchemaContent(contents);
    if (!content?.hash) {
        return { tree: {}, missionGuid, missionName };
    }

    const text = await fetchMissionFileText(content.hash, content.name || MISSION_SCHEMA_FILENAME);
    const schema = JSON.parse(text) as { assignments_org_chart?: unknown };
    return {
        tree: orgChartFromSchemaValue(schema.assignments_org_chart),
        missionGuid,
        missionName,
    };
}
