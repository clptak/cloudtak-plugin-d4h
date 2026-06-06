// Sync orchestration + per-session KV cache.
//
// Phase 3 cache strategy (per plan §4): keep the normalized roster in CloudTAK's
// shared Dexie `db.kv` under two keys, so a reload still shows the last sync and
// any other plugin in the same browser session could read it.
//
// Phase 3.5 will demote this to a NON-authoritative cache and add a Postgres-backed
// server route that enforces TAK-group visibility (plan §4A). Until then, the kv
// cache is the only persistence layer.
//
// Keys:
//   d4h:roster  → JSON D4HRoster (members + equipment + meta)
//   d4h:meta    → JSON D4HRosterMeta (cheap header read without parsing the whole roster)

import KV from '../../../src/base/kv.ts';
import { liveQuery, type Observable } from 'dexie';
import { db } from '../../../src/database.ts';

import { fetchMembers, fetchEquipment, fetchEquipmentCategories, fetchQualifications } from './d4h-client.ts';
import { normalizeMember, normalizeEquipment, normalizeEquipmentCategory, normalizeQualification } from './d4h-normalize.ts';
import { categoryIsWanted, WANTED_CATEGORY_KEYWORDS } from './d4h-equipment-categories.ts';
import type { D4HConfig } from './d4h-config.ts';
import type {
    D4HMember, D4HEquipment, D4HQualification, D4HRoster, D4HRosterMeta,
} from './d4h-types.ts';

export const ROSTER_KEY = 'd4h:roster';
export const META_KEY   = 'd4h:meta';

export interface FetchStats {
    pages:         number;
    rawCount:      number;
    reportedTotal: number | null;
}

export interface SyncResult {
    ok:        boolean;
    roster?:   D4HRoster;
    error?:    string;
    warnings:  string[];
    /** Per-endpoint pagination stats for the UI to display & sanity-check. */
    stats: {
        members:        FetchStats;
        equipment:      FetchStats;
        qualifications: FetchStats;
    };
}

const EMPTY_STATS: FetchStats = { pages: 0, rawCount: 0, reportedTotal: null };

export async function syncNow(config: D4HConfig): Promise<SyncResult> {
    const warnings: string[] = [];
    let membersResp;

    try {
        membersResp = await fetchMembers(config);
    } catch (e) {
        return {
            ok: false,
            error: `Members fetch failed: ${(e as Error).message}`,
            warnings,
            stats: { members: EMPTY_STATS, equipment: EMPTY_STATS, qualifications: EMPTY_STATS },
        };
    }

    // Operational-only roster. We ask D4H to filter server-side (see fetchMembers);
    // this client-side pass is the authoritative guarantee — it keeps the result
    // operational-only even if D4H ignored or rejected the server-side filter.
    const OPERATIONAL = 'OPERATIONAL';
    const members: D4HMember[] = [];
    let droppedMembers = 0;
    let nonOperational = 0;
    for (const raw of membersResp.records) {
        const m = normalizeMember(raw);
        if (!m) { droppedMembers++; continue; }
        if (m.status !== OPERATIONAL) { nonOperational++; continue; }
        members.push(m);
    }
    if (droppedMembers > 0) {
        warnings.push(`Dropped ${droppedMembers} member record(s) missing id/name during normalize.`);
    }
    if (nonOperational > 0) {
        warnings.push(`Excluded ${nonOperational} non-operational member(s) client-side (D4H did not filter server-side).`);
    }
    if (
        membersResp.reportedTotal != null &&
        membersResp.records.length < membersResp.reportedTotal
    ) {
        warnings.push(
            `Member pagination short: fetched ${membersResp.records.length} of ${membersResp.reportedTotal} reported by D4H (paged ${membersResp.pages} times).`,
        );
    }

    // Equipment — best-effort. Fetch everything, DISCOVER the distinct categories
    // (so the operator can see D4H's exact team-defined labels), then keep only the
    // wanted ones (vehicles / UAS / tech litter). Filtering is client-side and
    // authoritative — see lib/d4h-equipment-categories.ts.
    const equipResp = await fetchEquipment(config);
    if (equipResp.warning) warnings.push(equipResp.warning);

    const allEquipment: D4HEquipment[] = [];
    let droppedEquipment = 0;
    for (const raw of equipResp.records) {
        const e = normalizeEquipment(raw);
        if (e) allEquipment.push(e);
        else droppedEquipment++;
    }
    if (droppedEquipment > 0) {
        warnings.push(`Dropped ${droppedEquipment} equipment record(s) missing id during normalize.`);
    }

    // Resolve category id → title (equipment records carry only the category id).
    const catResp = await fetchEquipmentCategories(config);
    if (catResp.warning) warnings.push(catResp.warning);
    const categoryTitleById = new Map<number, string>();
    for (const raw of catResp.records) {
        const c = normalizeEquipmentCategory(raw);
        if (c) categoryTitleById.set(c.id, c.title);
    }
    for (const e of allEquipment) {
        if (e.category) continue;                 // already had an inline title
        if (e.categoryId != null) {
            e.category = categoryTitleById.get(e.categoryId) ?? `Category ${e.categoryId}`;
        }
    }

    // Discovery: distinct categories with counts, flagged by whether the filter keeps them.
    const categoryCounts = new Map<string, number>();
    for (const e of allEquipment) {
        const title = e.category ?? '(uncategorized)';
        categoryCounts.set(title, (categoryCounts.get(title) ?? 0) + 1);
    }
    const equipmentCategories = [...categoryCounts.entries()]
        .map(([title, count]) => ({ title, count, included: categoryIsWanted(title) }))
        .sort((a, b) => b.count - a.count);

    const equipment = allEquipment.filter(e => categoryIsWanted(e.category));

    // Flag any wanted keyword that matched nothing — almost always a label-spelling
    // mismatch the operator can fix by editing WANTED_CATEGORY_KEYWORDS.
    const unmatched = WANTED_CATEGORY_KEYWORDS.filter(
        k => !equipmentCategories.some(c => c.included && c.title.toLowerCase().includes(k)),
    );
    if (allEquipment.length > 0 && unmatched.length > 0) {
        warnings.push(
            `Equipment category filter matched no items for: ${unmatched.join(', ')}. ` +
            `D4H's categories are: ${equipmentCategories.map(c => `${c.title} (${c.count})`).join(', ') || 'none'}. ` +
            `Adjust WANTED_CATEGORY_KEYWORDS in lib/d4h-equipment-categories.ts if a label differs.`,
        );
    }

    // Qualifications — best-effort; join onto members by memberId.
    const qualResp = await fetchQualifications(config);
    if (qualResp.warning) warnings.push(qualResp.warning);
    const qualsByMember = new Map<number, D4HQualification[]>();
    for (const raw of qualResp.records) {
        const q = normalizeQualification(raw);
        if (!q || q.memberId == null) continue;
        const list = qualsByMember.get(q.memberId) ?? [];
        list.push(q);
        qualsByMember.set(q.memberId, list);
    }
    if (qualsByMember.size > 0) {
        for (const m of members) {
            const list = qualsByMember.get(m.id);
            if (list && list.length) m.qualifications = list;
        }
    }

    const stats = {
        members: {
            pages:         membersResp.pages,
            rawCount:      membersResp.records.length,
            reportedTotal: membersResp.reportedTotal,
        },
        equipment: {
            pages:         equipResp.pages,
            rawCount:      equipResp.records.length,
            reportedTotal: equipResp.reportedTotal,
        },
        qualifications: {
            pages:         qualResp.pages,
            rawCount:      qualResp.records.length,
            reportedTotal: qualResp.reportedTotal,
        },
    };

    const meta: D4HRosterMeta = {
        fetchedAt:      new Date().toISOString(),
        region:         config.region,
        context:        config.context,
        contextId:      config.contextId,
        memberCount:    members.length,
        equipmentCount: equipment.length,
        equipmentCategories,
        warnings,
    };
    const roster: D4HRoster = { meta, members, equipment };

    try {
        await KV.update(ROSTER_KEY, JSON.stringify(roster));
        await KV.update(META_KEY,   JSON.stringify(meta));
    } catch (e) {
        return {
            ok:       false,
            error:    `Persisted to memory but kv write failed: ${(e as Error).message}`,
            roster,
            warnings,
            stats,
        };
    }

    return { ok: true, roster, warnings, stats };
}

export async function loadCachedRoster(): Promise<D4HRoster | null> {
    const v = await KV.value(ROSTER_KEY);
    if (!v) return null;
    try { return JSON.parse(v) as D4HRoster; } catch { return null; }
}

export async function loadCachedMeta(): Promise<D4HRosterMeta | null> {
    const v = await KV.value(META_KEY);
    if (!v) return null;
    try { return JSON.parse(v) as D4HRosterMeta; } catch { return null; }
}

export async function clearCachedRoster(): Promise<void> {
    try { await KV.delete(ROSTER_KEY); } catch { /* ignore */ }
    try { await KV.delete(META_KEY);   } catch { /* ignore */ }
}

/**
 * Reactive observable on the meta key — HomeView subscribes so the "last sync"
 * line updates immediately after a sync (or after another tab/plugin updates kv).
 * Returns the parsed meta or null.
 */
export function liveMeta(): Observable<D4HRosterMeta | null> {
    return liveQuery(async () => {
        const row = await db.kv.get(META_KEY);
        if (!row?.value) return null;
        try { return JSON.parse(row.value) as D4HRosterMeta; } catch { return null; }
    });
}
