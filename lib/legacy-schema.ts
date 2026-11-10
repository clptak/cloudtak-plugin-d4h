// DEPRECATED fallback: read incident-manager's mission_schema.json /
// *_DataSync.json from a DataSync's contents. Used only for incidents that
// have not moved to TAK Server 5.9 Mission Properties (no `meta.schema` key).
// Remove once every server and incident is on Mission Properties.

import Subscription from '../../../src/base/subscription.ts';
import { server } from '../../../src/std.ts';
import type { MissionRef } from './mgmt-mission.ts';

const MISSION_SCHEMA_FILENAME = 'mission_schema.json';
const MISSION_SCHEMA_SUFFIX = '_DataSync.json';

interface ContentLike {
    hash?: string;
    name?: string;
    submissionTime?: string;
}

export interface LegacySchema {
    assignments_org_chart?: unknown;
    incident_response?: { subjects?: unknown };
}

function isMissionSchemaContentName(name: string | undefined): boolean {
    if (!name) return false;
    return name.endsWith(MISSION_SCHEMA_SUFFIX) || name.endsWith(MISSION_SCHEMA_FILENAME);
}

function findLatestSchemaContent(contents: ContentLike[]): ContentLike | null {
    const matches = contents.filter((c) => isMissionSchemaContentName(c.name) && c.hash);
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

/** The latest schema file on the mission, or null when there is none. */
export async function loadLegacySchemaFile(
    mission: MissionRef,
): Promise<{ schema: LegacySchema; fileName: string } | null> {
    const sub = await Subscription.load(mission.guid, {
        missiontoken: mission.token,
        subscribed: true,
    });
    if (sub.fetch) await sub.fetch();

    const content = findLatestSchemaContent(await sub.contents.list());
    if (!content?.hash) return null;

    const fileName = content.name || MISSION_SCHEMA_FILENAME;
    const schema = JSON.parse(await fetchMissionFileText(content.hash, fileName)) as LegacySchema;
    return { schema, fileName };
}
