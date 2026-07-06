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

import { fetchMembers, fetchEquipment, fetchEquipmentCategories, fetchEquipmentBrands, fetchEquipmentModels, fetchQualificationCatalog, fetchQualificationAwards, fetchExternalResources, fetchIncidents } from './d4h-client.ts';
import { normalizeMember, normalizeEquipment, normalizeEquipmentCategory, normalizeEquipmentBrand, normalizeEquipmentModel, normalizeQualificationDef, normalizeQualificationAward, normalizeIncident } from './d4h-normalize.ts';
import { categoryIsWanted, WANTED_CATEGORY_KEYWORDS } from './d4h-equipment-categories.ts';
import { isOperationalEquipmentStatus } from './d4h-status.ts';
import type { D4HConfig } from './d4h-config.ts';
import type {
    D4HMember, D4HEquipment, D4HQualification, D4HRoster, D4HRosterMeta, D4HExternalResource, D4HIncident,
} from './d4h-types.ts';

export const ROSTER_KEY = 'd4h:roster';
export const META_KEY   = 'd4h:meta';

export interface FetchStats {
    pages:         number;
    rawCount:      number;
    reportedTotal: number | null;
}

export interface ExternalResourceFetchStats {
    queriesRun: number;
    pages:      number;
    rawCount:   number;
}

export interface SyncResult {
    ok:        boolean;
    roster?:   D4HRoster;
    error?:    string;
    warnings:  string[];
    /** Per-endpoint pagination stats for the UI to display & sanity-check. */
    stats: {
        members:            FetchStats;
        equipment:          FetchStats;
        qualifications:     FetchStats;
        externalResources:  ExternalResourceFetchStats;
        incidents:          FetchStats;
    };
}

const EMPTY_STATS: FetchStats = { pages: 0, rawCount: 0, reportedTotal: null };
const EMPTY_EXT_STATS: ExternalResourceFetchStats = { queriesRun: 0, pages: 0, rawCount: 0 };

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
            stats: { members: EMPTY_STATS, equipment: EMPTY_STATS, qualifications: EMPTY_STATS, externalResources: EMPTY_EXT_STATS, incidents: EMPTY_STATS },
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

    // Resolve brand / model titles (list rows often carry id-only refs — see D4H swagger).
    const brandResp = await fetchEquipmentBrands(config);
    if (brandResp.warning) warnings.push(brandResp.warning);
    const brandTitleById = new Map<number, string>();
    for (const raw of brandResp.records) {
        const b = normalizeEquipmentBrand(raw);
        if (b) brandTitleById.set(b.id, b.title);
    }

    const modelResp = await fetchEquipmentModels(config);
    if (modelResp.warning) warnings.push(modelResp.warning);
    const modelById = new Map<number, { title: string; brandId?: number }>();
    for (const raw of modelResp.records) {
        const m = normalizeEquipmentModel(raw);
        if (m) modelById.set(m.id, { title: m.title, brandId: m.brandId });
    }

    for (const e of allEquipment) {
        if (!e.model && e.modelId != null) {
            e.model = modelById.get(e.modelId)?.title;
        }
        if (!e.make) {
            if (e.brandId != null) {
                e.make = brandTitleById.get(e.brandId);
            }
            if (!e.make && e.modelId != null) {
                const mid = modelById.get(e.modelId);
                if (mid?.brandId != null) {
                    e.make = brandTitleById.get(mid.brandId);
                }
            }
        }
    }

    // Discovery: distinct categories with counts (operational equipment only), flagged
    // by whether the filter keeps them.
    const operationalEquipment = allEquipment.filter(e => isOperationalEquipmentStatus(e.status));
    const nonOperationalEquipment = allEquipment.length - operationalEquipment.length;
    if (nonOperationalEquipment > 0) {
        warnings.push(`Excluded ${nonOperationalEquipment} non-operational equipment item(s).`);
    }

    const categoryCounts = new Map<string, number>();
    for (const e of operationalEquipment) {
        const title = e.category ?? '(uncategorized)';
        categoryCounts.set(title, (categoryCounts.get(title) ?? 0) + 1);
    }
    const equipmentCategories = [...categoryCounts.entries()]
        .map(([title, count]) => ({ title, count, included: categoryIsWanted(title) }))
        .sort((a, b) => b.count - a.count);

    const equipment = operationalEquipment.filter(e => categoryIsWanted(e.category));

    // Flag any wanted keyword that matched nothing — almost always a label-spelling
    // mismatch the operator can fix by editing WANTED_CATEGORY_KEYWORDS.
    const unmatched = WANTED_CATEGORY_KEYWORDS.filter(
        k => !equipmentCategories.some(c => c.included && c.title.toLowerCase().includes(k)),
    );
    if (operationalEquipment.length > 0 && unmatched.length > 0) {
        warnings.push(
            `Equipment category filter matched no items for: ${unmatched.join(', ')}. ` +
            `D4H's categories are: ${equipmentCategories.map(c => `${c.title} (${c.count})`).join(', ') || 'none'}. ` +
            `Adjust WANTED_CATEGORY_KEYWORDS in lib/d4h-equipment-categories.ts if a label differs.`,
        );
    }

    // Qualifications are a TWO-part model in D4H: a catalog of definitions (id → title,
    // no member link) plus award records (member → qualification id, with dates). We pull
    // both, resolve each award's title from the catalog, group by member, and collapse
    // repeat awards of the same qualification down to the latest (most recent expiry).
    const qualCatResp = await fetchQualificationCatalog(config);
    if (qualCatResp.warning) warnings.push(qualCatResp.warning);
    const qualTitleById = new Map<number, string>();
    for (const raw of qualCatResp.records) {
        const d = normalizeQualificationDef(raw);
        if (d) qualTitleById.set(d.id, d.title);
    }

    const awardResp = await fetchQualificationAwards(config);
    if (awardResp.warning) warnings.push(awardResp.warning);
    const qualsByMember = new Map<number, D4HQualification[]>();
    for (const raw of awardResp.records) {
        const a = normalizeQualificationAward(raw);
        if (!a) continue;
        const name = (a.qualId != null ? qualTitleById.get(a.qualId) : undefined)
            ?? `Qualification ${a.qualId ?? a.id}`;
        const list = qualsByMember.get(a.memberId) ?? [];
        list.push({ id: a.qualId ?? a.id, name, expiresAt: a.expiresAt, memberId: a.memberId });
        qualsByMember.set(a.memberId, list);
    }
    for (const m of members) {
        const list = qualsByMember.get(m.id);
        if (!list || !list.length) continue;
        const latestByName = new Map<string, D4HQualification>();
        for (const q of list) {
            const prev = latestByName.get(q.name);
            if (!prev || (q.expiresAt ?? '') > (prev.expiresAt ?? '')) latestByName.set(q.name, q);
        }
        m.qualifications = [...latestByName.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    // External Resource Tracker (Intelligence → Resources) — search API, best-effort.
    const extResp = await fetchExternalResources(config);
    if (extResp.warning) warnings.push(extResp.warning);
    const externalResources: D4HExternalResource[] = extResp.records;

    // Incidents from the last 30 days — GET /incidents?starts_after=… (swagger).
    const prevRoster = await loadCachedRoster();
    const missionGuidById = new Map(
        (prevRoster?.incidents ?? [])
            .filter(i => i.missionGuid)
            .map(i => [i.id, i.missionGuid!]),
    );

    const incResp = await fetchIncidents(config);
    if (incResp.warning) warnings.push(incResp.warning);
    const incidents: D4HIncident[] = [];
    let droppedIncidents = 0;
    for (const raw of incResp.records) {
        const inc = normalizeIncident(raw);
        if (inc) {
            const missionGuid = missionGuidById.get(inc.id);
            if (missionGuid) inc.missionGuid = missionGuid;
            incidents.push(inc);
        } else droppedIncidents++;
    }
    // Keep plugin-submitted incidents until D4H returns them on the next fetch.
    const fetchedIds = new Set(incidents.map(i => i.id));
    for (const prev of prevRoster?.incidents ?? []) {
        if (prev.missionGuid && !fetchedIds.has(prev.id)) incidents.unshift(prev);
    }
    if (droppedIncidents > 0) {
        warnings.push(`Dropped ${droppedIncidents} incident record(s) missing id during normalize.`);
    }
    if (
        incResp.reportedTotal != null &&
        incResp.records.length < incResp.reportedTotal
    ) {
        warnings.push(
            `Incident pagination short: fetched ${incResp.records.length} of ${incResp.reportedTotal} reported by D4H (paged ${incResp.pages} times).`,
        );
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
            pages:         awardResp.pages,
            rawCount:      awardResp.records.length,
            reportedTotal: awardResp.reportedTotal,
        },
        externalResources: {
            queriesRun: extResp.queriesRun,
            pages:      extResp.pages,
            rawCount:   externalResources.length,
        },
        incidents: {
            pages:         incResp.pages,
            rawCount:      incResp.records.length,
            reportedTotal: incResp.reportedTotal,
        },
    };

    const meta: D4HRosterMeta = {
        fetchedAt:      new Date().toISOString(),
        region:         config.region,
        context:        config.context,
        contextId:      config.contextId,
        memberCount:    members.length,
        equipmentCount: equipment.length,
        externalResourceCount: externalResources.length,
        incidentCount:         incidents.length,
        equipmentCategories,
        warnings,
    };
    const roster: D4HRoster = { meta, members, equipment, externalResources, incidents };

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
 * Insert or replace one incident in the cached roster (e.g. after Submit Incident).
 * New rows are prepended so the latest activity is easy to find before the next full sync.
 */
export async function upsertCachedIncident(incident: D4HIncident): Promise<D4HRoster | null> {
    const existing = await loadCachedRoster();
    const roster: D4HRoster = existing ?? {
        meta: {
            fetchedAt:      new Date().toISOString(),
            region:         '',
            context:        '',
            contextId:      0,
            memberCount:    0,
            equipmentCount: 0,
            warnings:       [],
        },
        members:   [],
        equipment: [],
        incidents: [],
    };

    const incidents = [...(roster.incidents ?? [])];
    const idx = incidents.findIndex(i => i.id === incident.id);
    if (idx >= 0) incidents[idx] = { ...incidents[idx], ...incident };
    else incidents.unshift(incident);

    roster.incidents = incidents;
    roster.meta = { ...roster.meta, incidentCount: incidents.length };

    try {
        await KV.update(ROSTER_KEY, JSON.stringify(roster));
        await KV.update(META_KEY,   JSON.stringify(roster.meta));
    } catch {
        return null;
    }
    return roster;
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
