// Read-only client for TAK Server 5.9+ Mission Properties (key/value pairs on a
// DataSync), via CloudTAK's /api/marti/missions/:guid/property routes.
//
// incident-manager stores its planning data on the MGMT DataSync with this
// layout (its src/lib/schemaCodec.ts / propertyKeys.ts):
//   meta.schema                    layout version; present once an incident uses properties
//   s.<field>                      one top-level schema field, JSON ("_" written as "-")
//   s.incident-response.<field>    one incident_response field, JSON
// This plugin only reads; it never writes properties.

import { Preferences } from '@capacitor/preferences';
import { stdurl } from '../../../src/std.ts';

export const META_SCHEMA_KEY = 'meta.schema';
export const ORG_CHART_KEY = 's.assignments-org-chart';
export const SUBJECTS_KEY = 's.incident-response.subjects';

export class MissionPropertyError extends Error {
    readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'MissionPropertyError';
        this.status = status;
    }
}

async function request(path: string, missionToken?: string): Promise<{ status: number; json?: unknown; text: string }> {
    const { value: token } = await Preferences.get({ key: 'token' });
    const headers: Record<string, string> = { 'X-Requested-With': 'XMLHttpRequest' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (missionToken) headers.MissionAuthorization = missionToken;

    const res = await fetch(stdurl(path).toString(), { method: 'GET', headers });
    const text = await res.text().catch(() => '');
    let json: unknown;
    if (text.trim()) {
        try { json = JSON.parse(text); } catch { json = undefined; }
    }
    return { status: res.status, json, text };
}

function errorMessage(status: number, json: unknown, text: string, action: string): string {
    const msg = (json as { message?: unknown } | undefined)?.message;
    if (typeof msg === 'string' && msg.trim()) return `${action} failed (${status}): ${msg}`;
    const t = text.trim();
    if (t && !t.includes('<html') && !t.includes('<!DOCTYPE')) return `${action} failed (${status}): ${t.slice(0, 200)}`;
    return `${action} failed (${status})`;
}

/** Raw value of one property, or null when the key does not exist. */
export async function getMissionProperty(
    missionGuid: string,
    key: string,
    missionToken?: string,
): Promise<string | null> {
    const path = `/api/marti/missions/${encodeURIComponent(missionGuid)}/property/${encodeURIComponent(key)}`;
    const res = await request(path, missionToken);
    if (res.status === 404) return null;
    if (res.status !== 200) {
        throw new MissionPropertyError(res.status, errorMessage(res.status, res.json, res.text, `Read ${key}`));
    }
    const data = (res.json as { data?: { value?: unknown } } | undefined)?.data;
    return typeof data?.value === 'string' ? data.value : null;
}

/** One property parsed as JSON; null when missing or empty. */
export async function getMissionPropertyJson<T>(
    missionGuid: string,
    key: string,
    missionToken?: string,
): Promise<T | null> {
    const raw = await getMissionProperty(missionGuid, key, missionToken);
    if (raw === null || raw === '') return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        throw new Error(`Mission property ${key} is not valid JSON`);
    }
}

/**
 * True when the incident on this mission is stored as Mission Properties
 * (incident-manager writes `meta.schema`). False on servers without the
 * feature or on incidents still on mission_schema.json. 401/403 are rethrown:
 * those are permission problems (for example no access to the MGMT channel).
 */
export async function usesMissionProperties(missionGuid: string, missionToken?: string): Promise<boolean> {
    try {
        return (await getMissionProperty(missionGuid, META_SCHEMA_KEY, missionToken)) !== null;
    } catch (err) {
        if (err instanceof MissionPropertyError && (err.status === 401 || err.status === 403)) throw err;
        return false;
    }
}
