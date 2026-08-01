// Thin client wrappers for the hybrid D4H server routes (`/api/d4h/*`).
// Prefer these when the server route is installed; fall back to client-direct
// sync (lib/d4h-roster.ts syncNow) when the API is missing or unconfigured.

import { std } from '../../../src/std.ts';
import type { D4HRoster, D4HRosterMeta, D4HMember, D4HEquipment } from './d4h-types.ts';
import type { SyncResult } from './d4h-roster.ts';

export interface D4HServerConfigPublic {
    available?: boolean;
    configured: boolean;
    tokenConfigured: boolean;
    region?: string;
    baseUrl?: string | null;
    context?: string;
    contextId?: number;
    defaultGroups: string[];
    syncIntervalMinutes: number;
    lastSyncAt?: string | null;
    lastSyncStatus?: string | null;
    lastSyncError?: string | null;
}

export interface D4HServerConfigUpdate {
    region?: string;
    baseUrl?: string | null;
    context?: string;
    contextId?: number;
    /** Omit or leave blank to keep the existing server token. */
    token?: string;
    defaultGroups?: string[];
    syncIntervalMinutes?: number;
    clearToken?: boolean;
}

function isNotFound(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /Status Code:\s*404|API endpoint does not exist/i.test(msg);
}

/** Probe whether `/api/d4h/config` exists. Returns null if the route is not installed. */
export async function getServerConfig(): Promise<D4HServerConfigPublic | null> {
    try {
        const res = await std('/api/d4h/config') as D4HServerConfigPublic;
        return { ...res, available: true };
    } catch (e) {
        if (isNotFound(e)) return null;
        // Auth or other errors still mean the route exists.
        if (String((e as Error).message) === '401') throw e;
        // Treat unexpected errors as "route may exist but failed" — rethrow.
        throw e;
    }
}

export async function updateServerConfig(
    body: D4HServerConfigUpdate,
): Promise<D4HServerConfigPublic> {
    return await std('/api/d4h/config', {
        method: 'PUT',
        body,
    }) as D4HServerConfigPublic;
}

export async function fetchServerRoster(): Promise<D4HRoster> {
    return await std('/api/d4h/roster') as D4HRoster;
}

export async function fetchServerMeta(): Promise<{
    meta: D4HRosterMeta | null;
    server: D4HServerConfigPublic;
}> {
    return await std('/api/d4h/meta') as {
        meta: D4HRosterMeta | null;
        server: D4HServerConfigPublic;
    };
}

export async function fetchServerMembers(opts: {
    ref?: string;
    callsign?: string;
} = {}): Promise<D4HMember[]> {
    const q = new URLSearchParams();
    if (opts.ref) q.set('ref', opts.ref);
    if (opts.callsign) q.set('callsign', opts.callsign);
    const qs = q.toString();
    const res = await std(`/api/d4h/members${qs ? `?${qs}` : ''}`) as { members: D4HMember[] };
    return res.members ?? [];
}

export async function fetchServerEquipment(): Promise<D4HEquipment[]> {
    const res = await std('/api/d4h/equipment') as { equipment: D4HEquipment[] };
    return res.equipment ?? [];
}

/**
 * Admin-triggered server sync (Postgres pull from D4H).
 * Maps the server SyncResult into the client SyncResult shape.
 */
export async function triggerServerSync(): Promise<SyncResult> {
    // Server sync can take several minutes — raise the default std timeout.
    const res = await std('/api/d4h/sync', {
        method: 'POST',
        timeout: 10 * 60 * 1000,
    }) as SyncResult;
    return res;
}

/**
 * True when the hybrid server route is installed and has a D4H token configured.
 */
export async function isServerSyncAvailable(): Promise<boolean> {
    try {
        const cfg = await getServerConfig();
        return !!(cfg?.tokenConfigured);
    } catch {
        return false;
    }
}
