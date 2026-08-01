// @ts-nocheck — API route module; typechecked in CloudTAK api, not api/web vue-tsc
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable */
// Server-side D4H fetch + normalize + Postgres persist.
//
// Copied into CloudTAK api/stateless/routes/ alongside plugin-d4h.ts.
// schema.load() imports every .ts/.js in that directory, so this module exports
// a no-op default router; the real API is runD4HSync / loadServerConfig / etc.

import { sql } from 'drizzle-orm';

export type D4HRegion = 'us' | 'eu' | 'ap' | 'ca';
export type D4HContext = 'team' | 'organization';

export interface ServerD4HConfig {
    region: D4HRegion;
    baseUrl?: string | null;
    context: D4HContext;
    contextId: number;
    token: string;
    defaultGroups: string[];
    syncIntervalMinutes: number;
    lastSyncAt?: string | null;
    lastSyncStatus?: string | null;
    lastSyncError?: string | null;
}

export interface D4HQualification {
    id: number;
    name: string;
    expiresAt?: string;
    memberId?: number;
}

export interface D4HMember {
    id: number;
    ref?: string;
    name: string;
    callsign?: string;
    position?: string;
    status?: string;
    email?: string;
    mobile?: string;
    phone?: string;
    qualifications?: D4HQualification[];
    groups?: string[];
}

export interface D4HEquipment {
    id: number;
    ref?: string;
    name: string;
    make?: string;
    model?: string;
    brandId?: number;
    modelId?: number;
    categoryId?: number;
    category?: string;
    status?: string;
    groups?: string[];
}

export interface D4HExternalResource {
    id: number;
    name: string;
    groups?: string[];
}

export interface D4HIncident {
    id: number;
    reference?: string;
    title: string;
    startsAt?: string;
    endsAt?: string;
    trackingNumber?: string;
    description?: string;
    published?: boolean;
    missionGuid?: string;
    groups?: string[];
}

export interface D4HRosterMeta {
    fetchedAt: string;
    region: string;
    context: string;
    contextId: number;
    contextName?: string;
    memberCount: number;
    equipmentCount: number;
    externalResourceCount?: number;
    incidentCount?: number;
    equipmentCategories?: { title: string; count: number; included: boolean }[];
    warnings: string[];
}

export interface D4HRoster {
    meta: D4HRosterMeta;
    members: D4HMember[];
    equipment: D4HEquipment[];
    externalResources?: D4HExternalResource[];
    incidents?: D4HIncident[];
}

export interface FetchStats {
    pages: number;
    rawCount: number;
    reportedTotal: number | null;
}

export interface SyncResult {
    ok: boolean;
    roster?: D4HRoster;
    error?: string;
    warnings: string[];
    stats: {
        members: FetchStats;
        equipment: FetchStats;
        qualifications: FetchStats;
        externalResources: { queriesRun: number; pages: number; rawCount: number };
        incidents: FetchStats;
    };
}

type PgConfig = { pg: { execute: (statement: ReturnType<typeof sql>) => Promise<unknown> } };
type Json = Record<string, unknown>;
type RawRecord = Record<string, unknown>;

const WANTED_CATEGORY_KEYWORDS = ['vehicle', 'uas', 'tech litter'] as const;
const EXTERNAL_RESOURCE_SEARCH_QUERIES = [
    'county', 'sheriff', 'office', 'forest', 'ranger', 'service', 'national', 'park',
    'monument', 'fire', 'rescue', 'tribal', 'nation', 'municipal', 'helicopter',
    'aviation', 'bureau', 'management', 'police', 'department', 'medical', 'hospital',
    'state', 'federal', 'agency', 'sar',
] as const;

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGES = 500;
const EMPTY_STATS: FetchStats = { pages: 0, rawCount: 0, reportedTotal: null };
const EMPTY_EXT = { queriesRun: 0, pages: 0, rawCount: 0 };

/** No-op so schema.load() can import this file safely. */
export default async function router(): Promise<void> { /* helper module */ }

async function query<T>(config: PgConfig, statement: ReturnType<typeof sql>): Promise<T[]> {
    const result = await config.pg.execute(statement);
    return result as unknown as T[];
}

function asArray(v: unknown): unknown[] {
    let x: unknown = v;
    for (let i = 0; i < 4 && typeof x === 'string'; i++) {
        try { x = JSON.parse(x); } catch { return []; }
    }
    return Array.isArray(x) ? x : [];
}

function asStringArray(v: unknown): string[] {
    return asArray(v).map(String).filter(Boolean);
}

function textArraySql(groups: string[]): ReturnType<typeof sql> {
    if (!groups.length) return sql`'{}'::TEXT[]`;
    const escaped = groups.map((g) => `'${String(g).replace(/'/g, "''")}'`).join(', ');
    return sql.raw(`ARRAY[${escaped}]::TEXT[]`);
}

function regionBaseUrl(region: D4HRegion): string {
    return `https://api.team-manager.${region}.d4h.com`;
}

function effectiveBaseUrl(config: Pick<ServerD4HConfig, 'region' | 'baseUrl'>): string {
    const override = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
    return override || regionBaseUrl(config.region);
}

function categoryIsWanted(category: string | undefined): boolean {
    if (!category) return false;
    const c = category.toLowerCase();
    return WANTED_CATEGORY_KEYWORDS.some((k) => c.includes(k));
}

function isOperationalEquipmentStatus(status?: string): boolean {
    if (!status) return false;
    return status.trim().toUpperCase().startsWith('OPERATIONAL');
}

function str(v: unknown): string | undefined {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t.length ? t : undefined;
}

function num(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return undefined;
}

function nestedString(obj: unknown, ...keys: string[]): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    let cur: unknown = obj;
    for (const k of keys) {
        if (!cur || typeof cur !== 'object') return undefined;
        cur = (cur as Json)[k];
    }
    return str(cur);
}

function fieldString(obj: unknown, key: string): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    const v = (obj as Json)[key];
    if (typeof v === 'string') return str(v);
    if (v && typeof v === 'object') {
        return nestedString(v, 'title') ?? nestedString(v, 'name');
    }
    return undefined;
}

function normalizeMember(raw: Json): D4HMember | null {
    const id = num(raw.id);
    const name = str(raw.name);
    if (id === undefined || !name) return null;
    const email = nestedString(raw.email, 'value');
    const mobile = nestedString(raw.mobile, 'phone');
    const phone = mobile ?? nestedString(raw.work, 'phone') ?? nestedString(raw.home, 'phone');
    return {
        id, name, email, mobile, phone,
        ref: str(raw.ref),
        position: str(raw.position),
        status: str(raw.status),
    };
}

function normalizeEquipment(raw: Json): D4HEquipment | null {
    const id = num(raw.id);
    if (id === undefined) return null;
    const name =
        nestedString(raw.kind, 'title') ??
        str(raw.name) ?? str(raw.title) ?? str(raw.ref) ?? `Equipment ${id}`;
    const brandId =
        num((raw.brand as Json | undefined)?.id) ??
        num(((raw.model as Json | undefined)?.brand as Json | undefined)?.id);
    const modelId = num((raw.model as Json | undefined)?.id);
    const make =
        fieldString(raw, 'brand') ??
        fieldString(raw.model, 'brand') ??
        fieldString(raw.kind, 'brand') ??
        fieldString(raw, 'manufacturer') ??
        str(raw.make);
    const model = nestedString(raw.model, 'title') ?? nestedString(raw.model, 'name');
    const categoryId =
        num((raw.category as Json | undefined)?.id) ??
        num(((raw.kind as Json | undefined)?.category as Json | undefined)?.id);
    const category = nestedString(raw.category, 'title') ?? nestedString(raw.category, 'name');
    return {
        id, ref: str(raw.ref), name, make, model, brandId, modelId, categoryId, category,
        status: str(raw.status) ?? nestedString(raw.status, 'name'),
    };
}

function normalizeEquipmentCategory(raw: Json): { id: number; title: string } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    return { id, title };
}

function normalizeEquipmentBrand(raw: Json): { id: number; title: string } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    return { id, title };
}

function normalizeEquipmentModel(raw: Json): { id: number; title: string; brandId?: number } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    const brandId = num((raw.brand as Json | undefined)?.id) ?? num(raw.brandId);
    return { id, title, brandId };
}

function normalizeQualificationDef(raw: Json): { id: number; title: string } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    return { id, title };
}

function normalizeQualificationAward(
    raw: Json,
): { id: number; memberId: number; qualId?: number; expiresAt?: string } | null {
    const id = num(raw.id);
    const memberId = num((raw.member as Json | undefined)?.id) ?? num(raw.memberId);
    if (id === undefined || memberId === undefined) return null;
    const qualId = num((raw.qualification as Json | undefined)?.id) ?? num(raw.qualificationId);
    const expiresAt = str(raw.endsAt) ?? str(raw.expiresAt) ?? str(raw.expires_at) ?? str(raw.expiry);
    return { id, memberId, qualId, expiresAt };
}

function normalizeIncident(raw: Json): D4HIncident | null {
    const id = num(raw.id);
    if (id === undefined) return null;
    const reference = str(raw.reference);
    const title = str(raw.referenceDescription) ?? reference ?? `Incident ${id}`;
    return {
        id, reference, title,
        startsAt: str(raw.startsAt),
        endsAt: str(raw.endsAt),
        trackingNumber: str(raw.trackingNumber),
        description: str(raw.description),
        published: typeof raw.published === 'boolean' ? raw.published : undefined,
    };
}

interface PagedEnvelope<T> {
    results?: T[];
    totalSize?: number;
    total?: number;
    totalCount?: number;
    meta?: { total?: number; totalSize?: number; totalCount?: number };
}

function readReportedTotal(body: PagedEnvelope<unknown>): number | null {
    const candidates = [
        body.totalSize, body.total, body.totalCount,
        body.meta?.totalSize, body.meta?.total, body.meta?.totalCount,
    ];
    for (const n of candidates) {
        if (typeof n === 'number' && n > 0) return n;
    }
    return null;
}

interface PaginatedFetchResult {
    records: RawRecord[];
    pages: number;
    reportedTotal: number | null;
}

interface BestEffortResult {
    records: RawRecord[];
    pages: number;
    reportedTotal: number | null;
    warning?: string;
}

async function fetchAllPages(
    cfg: ServerD4HConfig,
    path: string,
    options: { pageSize?: number; extraQuery?: Record<string, string | number> } = {},
): Promise<PaginatedFetchResult> {
    const baseUrl = effectiveBaseUrl(cfg);
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const all: RawRecord[] = [];
    const seenIds = new Set<unknown>();
    let reportedTotal: number | null = null;
    let pagesFetched = 0;
    let consecutiveZeroNew = 0;
    let maxConsecutiveZeroNew = 12;
    let pageBase = 0;

    for (let i = 0; i < MAX_PAGES; i++) {
        const page = pageBase + i;
        const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
        for (const [k, v] of Object.entries(options.extraQuery ?? {})) {
            params.set(k, String(v));
        }
        const url = `${baseUrl}${path}?${params.toString()}`;
        const res = await fetch(url, {
            method: 'GET',
            cache: 'no-store',
            headers: {
                Authorization: `Bearer ${cfg.token}`,
                Accept: 'application/json',
            },
        });
        if (!res.ok) {
            if (res.status === 400 && pageBase === 0 && i === 0) {
                pageBase = 1;
                i--;
                continue;
            }
            const detail = await res.text().catch(() => '');
            const err = new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 400)}`) as Error & { status?: number };
            err.status = res.status;
            throw err;
        }
        const body = await res.json() as PagedEnvelope<RawRecord>;
        const results = Array.isArray(body.results) ? body.results : [];
        pagesFetched++;
        let newlyAdded = 0;
        for (const r of results) {
            const id = (r as { id?: unknown }).id;
            if (id == null) { all.push(r); newlyAdded++; continue; }
            if (seenIds.has(id)) continue;
            seenIds.add(id);
            all.push(r);
            newlyAdded++;
        }
        const pageTotal = readReportedTotal(body);
        if (pageTotal != null) {
            reportedTotal = pageTotal;
            maxConsecutiveZeroNew = Math.max(12, Math.ceil(reportedTotal / pageSize) * 2 + 5);
        }
        if (results.length === 0) break;
        if (reportedTotal != null && all.length >= reportedTotal) break;
        if (newlyAdded === 0) {
            consecutiveZeroNew++;
            if (consecutiveZeroNew >= maxConsecutiveZeroNew) break;
        } else {
            consecutiveZeroNew = 0;
        }
    }
    return { records: all, pages: pagesFetched, reportedTotal };
}

function ctxPath(cfg: ServerD4HConfig): string {
    return `/v3/${encodeURIComponent(cfg.context)}/${cfg.contextId}`;
}

async function fetchMembers(cfg: ServerD4HConfig): Promise<PaginatedFetchResult> {
    const path = `${ctxPath(cfg)}/members`;
    try {
        const r = await fetchAllPages(cfg, path, { extraQuery: { status: 'OPERATIONAL' } });
        if (r.records.length === 0) return fetchAllPages(cfg, path);
        return r;
    } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 400) return fetchAllPages(cfg, path);
        throw e;
    }
}

async function fetchFromCandidates(
    cfg: ServerD4HConfig, candidates: string[], label: string,
): Promise<BestEffortResult> {
    const errors: string[] = [];
    for (const path of candidates) {
        try {
            const r = await fetchAllPages(cfg, path);
            return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
        } catch (e) {
            const err = e as Error & { status?: number };
            errors.push(`${path}: ${err.message}`);
            if (err.status !== 404) break;
        }
    }
    return { records: [], pages: 0, reportedTotal: null, warning: `${label} fetch failed. Tried: ${errors.join(' | ')}` };
}

async function fetchEquipment(cfg: ServerD4HConfig): Promise<BestEffortResult> {
    try {
        const r = await fetchAllPages(cfg, `${ctxPath(cfg)}/equipment`);
        return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
    } catch (e) {
        return { records: [], pages: 0, reportedTotal: null, warning: `Equipment fetch failed (${(e as Error).message}).` };
    }
}

function incidentsWindowStartsAfter(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 30);
    return d.toISOString();
}

async function fetchIncidents(cfg: ServerD4HConfig): Promise<BestEffortResult> {
    try {
        const r = await fetchAllPages(cfg, `${ctxPath(cfg)}/incidents`, {
            extraQuery: {
                starts_after: incidentsWindowStartsAfter(),
                sort: 'startsAt',
                order: 'desc',
                include_ongoing: 'true',
            },
        });
        return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
    } catch (e) {
        return { records: [], pages: 0, reportedTotal: null, warning: `Incidents fetch failed (${(e as Error).message}).` };
    }
}

async function fetchExternalResources(cfg: ServerD4HConfig): Promise<{
    records: { id: number; name: string }[];
    queriesRun: number;
    pages: number;
    warning?: string;
}> {
    const seen = new Map<number, { id: number; name: string }>();
    let pages = 0;
    let queriesRun = 0;
    const errors: string[] = [];
    const baseUrl = effectiveBaseUrl(cfg);

    for (const q of EXTERNAL_RESOURCE_SEARCH_QUERIES) {
        try {
            for (let page = 0; page < 50; page++) {
                const params = new URLSearchParams({
                    query: q, resource_type: 'Resource', page: String(page), size: '100',
                });
                const url = `${baseUrl}${ctxPath(cfg)}/search?${params.toString()}`;
                const res = await fetch(url, {
                    method: 'GET',
                    cache: 'no-store',
                    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
                });
                if (!res.ok) {
                    const detail = await res.text().catch(() => '');
                    throw new Error(`HTTP ${res.status} — ${detail.slice(0, 200)}`);
                }
                const body = await res.json() as { results?: Array<{ id?: unknown; title?: unknown }> };
                const results = Array.isArray(body.results) ? body.results : [];
                pages++;
                for (const row of results) {
                    const id = typeof row.id === 'number' ? row.id : Number(row.id);
                    const name = typeof row.title === 'string' ? row.title.trim() : '';
                    if (!Number.isFinite(id) || !name) continue;
                    if (!seen.has(id)) seen.set(id, { id, name });
                }
                if (results.length === 0 || results.length < 100) break;
            }
            queriesRun++;
        } catch (e) {
            errors.push(`${q}: ${(e as Error).message}`);
        }
    }

    const records = [...seen.values()].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
    let warning: string | undefined;
    if (errors.length === EXTERNAL_RESOURCE_SEARCH_QUERIES.length) {
        warning = `External resources fetch failed for all search queries.`;
    } else if (errors.length > 0) {
        warning = `External resources: ${errors.length} search quer${errors.length === 1 ? 'y' : 'ies'} failed.`;
    }
    return { records, queriesRun, pages, warning };
}

async function fetchContextName(cfg: ServerD4HConfig): Promise<string | null> {
    try {
        const res = await fetch(`${effectiveBaseUrl(cfg)}${ctxPath(cfg)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const body = await res.json() as RawRecord;
        return str(body.title) ?? str(body.name) ?? null;
    } catch {
        return null;
    }
}

export async function loadServerConfig(config: PgConfig): Promise<ServerD4HConfig | null> {
    const rows = await query<{
        region: string;
        base_url: string | null;
        context: string;
        context_id: number;
        token: string;
        default_groups: unknown;
        sync_interval_minutes: number;
        last_sync_at: string | null;
        last_sync_status: string | null;
        last_sync_error: string | null;
    }>(config, sql`
        SELECT region, base_url, context, context_id, token, default_groups,
               sync_interval_minutes, last_sync_at, last_sync_status, last_sync_error
        FROM d4h_config WHERE id = 1
    `);
    const row = rows[0];
    if (!row || !row.token) return null;
    return {
        region: row.region as D4HRegion,
        baseUrl: row.base_url,
        context: row.context as D4HContext,
        contextId: Number(row.context_id),
        token: row.token,
        defaultGroups: asStringArray(row.default_groups),
        syncIntervalMinutes: Number(row.sync_interval_minutes) || 60,
        lastSyncAt: row.last_sync_at,
        lastSyncStatus: row.last_sync_status,
        lastSyncError: row.last_sync_error,
    };
}

export async function persistRoster(
    config: PgConfig,
    roster: D4HRoster,
    groups: string[],
): Promise<void> {
    const g = textArraySql(groups);
    const memberIds = roster.members.map((m) => m.id);
    const equipmentIds = roster.equipment.map((e) => e.id);
    const resourceIds = (roster.externalResources ?? []).map((r) => r.id);
    const incidentIds = (roster.incidents ?? []).map((i) => i.id);

    for (const m of roster.members) {
        await config.pg.execute(sql`
            INSERT INTO d4h_members (
                id, ref, name, callsign, position, status, email, mobile, phone,
                qualifications, groups, updated_at
            ) VALUES (
                ${m.id}, ${m.ref ?? null}, ${m.name}, ${m.callsign ?? null},
                ${m.position ?? null}, ${m.status ?? null}, ${m.email ?? null},
                ${m.mobile ?? null}, ${m.phone ?? null},
                ${JSON.stringify(m.qualifications ?? [])}::jsonb, ${g}, now()
            )
            ON CONFLICT (id) DO UPDATE SET
                ref = EXCLUDED.ref, name = EXCLUDED.name, callsign = EXCLUDED.callsign,
                position = EXCLUDED.position, status = EXCLUDED.status, email = EXCLUDED.email,
                mobile = EXCLUDED.mobile, phone = EXCLUDED.phone,
                qualifications = EXCLUDED.qualifications, groups = EXCLUDED.groups,
                updated_at = now()
        `);
    }
    if (memberIds.length) {
        await config.pg.execute(sql`
            DELETE FROM d4h_members WHERE NOT (id = ANY(${sql.raw(`ARRAY[${memberIds.join(',')}]::INT[]`)}))
        `);
    } else {
        await config.pg.execute(sql`DELETE FROM d4h_members`);
    }

    for (const e of roster.equipment) {
        await config.pg.execute(sql`
            INSERT INTO d4h_equipment (
                id, ref, name, make, model, brand_id, model_id, category_id, category, status, groups, updated_at
            ) VALUES (
                ${e.id}, ${e.ref ?? null}, ${e.name}, ${e.make ?? null}, ${e.model ?? null},
                ${e.brandId ?? null}, ${e.modelId ?? null}, ${e.categoryId ?? null},
                ${e.category ?? null}, ${e.status ?? null}, ${g}, now()
            )
            ON CONFLICT (id) DO UPDATE SET
                ref = EXCLUDED.ref, name = EXCLUDED.name, make = EXCLUDED.make, model = EXCLUDED.model,
                brand_id = EXCLUDED.brand_id, model_id = EXCLUDED.model_id,
                category_id = EXCLUDED.category_id, category = EXCLUDED.category,
                status = EXCLUDED.status, groups = EXCLUDED.groups, updated_at = now()
        `);
    }
    if (equipmentIds.length) {
        await config.pg.execute(sql`
            DELETE FROM d4h_equipment WHERE NOT (id = ANY(${sql.raw(`ARRAY[${equipmentIds.join(',')}]::INT[]`)}))
        `);
    } else {
        await config.pg.execute(sql`DELETE FROM d4h_equipment`);
    }

    for (const r of roster.externalResources ?? []) {
        await config.pg.execute(sql`
            INSERT INTO d4h_external_resources (id, name, groups, updated_at)
            VALUES (${r.id}, ${r.name}, ${g}, now())
            ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, groups = EXCLUDED.groups, updated_at = now()
        `);
    }
    if (resourceIds.length) {
        await config.pg.execute(sql`
            DELETE FROM d4h_external_resources WHERE NOT (id = ANY(${sql.raw(`ARRAY[${resourceIds.join(',')}]::INT[]`)}))
        `);
    } else {
        await config.pg.execute(sql`DELETE FROM d4h_external_resources`);
    }

    for (const i of roster.incidents ?? []) {
        await config.pg.execute(sql`
            INSERT INTO d4h_incidents (
                id, reference, title, starts_at, ends_at, tracking_number, description,
                published, mission_guid, groups, updated_at
            ) VALUES (
                ${i.id}, ${i.reference ?? null}, ${i.title}, ${i.startsAt ?? null}, ${i.endsAt ?? null},
                ${i.trackingNumber ?? null}, ${i.description ?? null},
                ${i.published ?? null}, ${i.missionGuid ?? null}, ${g}, now()
            )
            ON CONFLICT (id) DO UPDATE SET
                reference = EXCLUDED.reference, title = EXCLUDED.title,
                starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
                tracking_number = EXCLUDED.tracking_number, description = EXCLUDED.description,
                published = EXCLUDED.published,
                mission_guid = COALESCE(EXCLUDED.mission_guid, d4h_incidents.mission_guid),
                groups = EXCLUDED.groups, updated_at = now()
        `);
    }
    if (incidentIds.length) {
        // Keep plugin-submitted incidents that still have a mission_guid even if absent from D4H window.
        await config.pg.execute(sql`
            DELETE FROM d4h_incidents
            WHERE mission_guid IS NULL
              AND NOT (id = ANY(${sql.raw(`ARRAY[${incidentIds.join(',')}]::INT[]`)}))
        `);
    }

    await config.pg.execute(sql`
        INSERT INTO d4h_meta (id, payload, updated_at)
        VALUES (1, ${JSON.stringify(roster.meta)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
    `);
}

export async function runD4HSync(config: PgConfig, cfg: ServerD4HConfig): Promise<SyncResult> {
    const warnings: string[] = [];
    let membersResp: PaginatedFetchResult;

    try {
        membersResp = await fetchMembers(cfg);
    } catch (e) {
        return {
            ok: false,
            error: `Members fetch failed: ${(e as Error).message}`,
            warnings,
            stats: {
                members: EMPTY_STATS, equipment: EMPTY_STATS, qualifications: EMPTY_STATS,
                externalResources: EMPTY_EXT, incidents: EMPTY_STATS,
            },
        };
    }

    const members: D4HMember[] = [];
    let droppedMembers = 0;
    let nonOperational = 0;
    for (const raw of membersResp.records) {
        const m = normalizeMember(raw);
        if (!m) { droppedMembers++; continue; }
        if (m.status !== 'OPERATIONAL') { nonOperational++; continue; }
        m.groups = [...cfg.defaultGroups];
        members.push(m);
    }
    if (droppedMembers) warnings.push(`Dropped ${droppedMembers} member record(s) missing id/name during normalize.`);
    if (nonOperational) warnings.push(`Excluded ${nonOperational} non-operational member(s).`);

    const equipResp = await fetchEquipment(cfg);
    if (equipResp.warning) warnings.push(equipResp.warning);
    const allEquipment: D4HEquipment[] = [];
    let droppedEquipment = 0;
    for (const raw of equipResp.records) {
        const e = normalizeEquipment(raw);
        if (e) allEquipment.push(e);
        else droppedEquipment++;
    }
    if (droppedEquipment) warnings.push(`Dropped ${droppedEquipment} equipment record(s) missing id.`);

    const catResp = await fetchFromCandidates(cfg, [
        `${ctxPath(cfg)}/equipment-categories`,
        `${ctxPath(cfg)}/equipment/categories`,
    ], 'Equipment categories');
    if (catResp.warning) warnings.push(catResp.warning);
    const categoryTitleById = new Map<number, string>();
    for (const raw of catResp.records) {
        const c = normalizeEquipmentCategory(raw);
        if (c) categoryTitleById.set(c.id, c.title);
    }
    for (const e of allEquipment) {
        if (e.category) continue;
        if (e.categoryId != null) e.category = categoryTitleById.get(e.categoryId) ?? `Category ${e.categoryId}`;
    }

    const brandResp = await fetchFromCandidates(cfg, [
        `${ctxPath(cfg)}/equipment-brands`, `${ctxPath(cfg)}/equipment/brands`,
    ], 'Equipment brands');
    if (brandResp.warning) warnings.push(brandResp.warning);
    const brandTitleById = new Map<number, string>();
    for (const raw of brandResp.records) {
        const b = normalizeEquipmentBrand(raw);
        if (b) brandTitleById.set(b.id, b.title);
    }

    const modelResp = await fetchFromCandidates(cfg, [
        `${ctxPath(cfg)}/equipment-models`, `${ctxPath(cfg)}/equipment/models`,
    ], 'Equipment models');
    if (modelResp.warning) warnings.push(modelResp.warning);
    const modelById = new Map<number, { title: string; brandId?: number }>();
    for (const raw of modelResp.records) {
        const m = normalizeEquipmentModel(raw);
        if (m) modelById.set(m.id, { title: m.title, brandId: m.brandId });
    }

    for (const e of allEquipment) {
        if (!e.model && e.modelId != null) e.model = modelById.get(e.modelId)?.title;
        if (!e.make) {
            if (e.brandId != null) e.make = brandTitleById.get(e.brandId);
            if (!e.make && e.modelId != null) {
                const mid = modelById.get(e.modelId);
                if (mid?.brandId != null) e.make = brandTitleById.get(mid.brandId);
            }
        }
    }

    const operationalEquipment = allEquipment.filter((e) => isOperationalEquipmentStatus(e.status));
    const nonOpEq = allEquipment.length - operationalEquipment.length;
    if (nonOpEq > 0) warnings.push(`Excluded ${nonOpEq} non-operational equipment item(s).`);

    const categoryCounts = new Map<string, number>();
    for (const e of operationalEquipment) {
        const title = e.category ?? '(uncategorized)';
        categoryCounts.set(title, (categoryCounts.get(title) ?? 0) + 1);
    }
    const equipmentCategories = [...categoryCounts.entries()]
        .map(([title, count]) => ({ title, count, included: categoryIsWanted(title) }))
        .sort((a, b) => b.count - a.count);

    const equipment = operationalEquipment
        .filter((e) => categoryIsWanted(e.category))
        .map((e) => ({ ...e, groups: [...cfg.defaultGroups] }));

    const unmatched = WANTED_CATEGORY_KEYWORDS.filter(
        (k) => !equipmentCategories.some((c) => c.included && c.title.toLowerCase().includes(k)),
    );
    if (operationalEquipment.length > 0 && unmatched.length > 0) {
        warnings.push(
            `Equipment category filter matched no items for: ${unmatched.join(', ')}. ` +
            `D4H's categories are: ${equipmentCategories.map((c) => `${c.title} (${c.count})`).join(', ') || 'none'}.`,
        );
    }

    const qualCatResp = await fetchFromCandidates(cfg, [
        `${ctxPath(cfg)}/member-qualifications`, `${ctxPath(cfg)}/qualifications`,
    ], 'Qualification catalog');
    if (qualCatResp.warning) warnings.push(qualCatResp.warning);
    const qualTitleById = new Map<number, string>();
    for (const raw of qualCatResp.records) {
        const d = normalizeQualificationDef(raw);
        if (d) qualTitleById.set(d.id, d.title);
    }

    const awardResp = await fetchFromCandidates(cfg, [
        `${ctxPath(cfg)}/member-qualification-awards`, `${ctxPath(cfg)}/qualification-awards`,
    ], 'Qualification awards');
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
        if (!list?.length) continue;
        const latestByName = new Map<string, D4HQualification>();
        for (const q of list) {
            const prev = latestByName.get(q.name);
            if (!prev || (q.expiresAt ?? '') > (prev.expiresAt ?? '')) latestByName.set(q.name, q);
        }
        m.qualifications = [...latestByName.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    const extResp = await fetchExternalResources(cfg);
    if (extResp.warning) warnings.push(extResp.warning);
    const externalResources: D4HExternalResource[] = extResp.records.map((r) => ({
        ...r, groups: [...cfg.defaultGroups],
    }));

    const prevIncidents = await query<{ id: number; mission_guid: string | null }>(config, sql`
        SELECT id, mission_guid FROM d4h_incidents WHERE mission_guid IS NOT NULL
    `);
    const missionGuidById = new Map(
        prevIncidents.filter((i) => i.mission_guid).map((i) => [i.id, i.mission_guid as string]),
    );

    const incResp = await fetchIncidents(cfg);
    if (incResp.warning) warnings.push(incResp.warning);
    const incidents: D4HIncident[] = [];
    let droppedIncidents = 0;
    for (const raw of incResp.records) {
        const inc = normalizeIncident(raw);
        if (inc) {
            const missionGuid = missionGuidById.get(inc.id);
            if (missionGuid) inc.missionGuid = missionGuid;
            inc.groups = [...cfg.defaultGroups];
            incidents.push(inc);
        } else droppedIncidents++;
    }
    const fetchedIds = new Set(incidents.map((i) => i.id));
    for (const prev of prevIncidents) {
        if (prev.mission_guid && !fetchedIds.has(prev.id)) {
            incidents.unshift({
                id: prev.id,
                title: `Incident ${prev.id}`,
                missionGuid: prev.mission_guid,
                groups: [...cfg.defaultGroups],
            });
        }
    }
    if (droppedIncidents) warnings.push(`Dropped ${droppedIncidents} incident record(s) missing id.`);

    const contextName = await fetchContextName(cfg);
    if (!contextName) warnings.push('Could not fetch team/organization display name from D4H.');

    const stats = {
        members: { pages: membersResp.pages, rawCount: membersResp.records.length, reportedTotal: membersResp.reportedTotal },
        equipment: { pages: equipResp.pages, rawCount: equipResp.records.length, reportedTotal: equipResp.reportedTotal },
        qualifications: { pages: awardResp.pages, rawCount: awardResp.records.length, reportedTotal: awardResp.reportedTotal },
        externalResources: { queriesRun: extResp.queriesRun, pages: extResp.pages, rawCount: externalResources.length },
        incidents: { pages: incResp.pages, rawCount: incResp.records.length, reportedTotal: incResp.reportedTotal },
    };

    const meta: D4HRosterMeta = {
        fetchedAt: new Date().toISOString(),
        region: cfg.region,
        context: cfg.context,
        contextId: cfg.contextId,
        contextName: contextName ?? undefined,
        memberCount: members.length,
        equipmentCount: equipment.length,
        externalResourceCount: externalResources.length,
        incidentCount: incidents.length,
        equipmentCategories,
        warnings,
    };
    const roster: D4HRoster = { meta, members, equipment, externalResources, incidents };

    try {
        await persistRoster(config, roster, cfg.defaultGroups);
        await config.pg.execute(sql`
            UPDATE d4h_config SET
                last_sync_at = now(),
                last_sync_status = 'ok',
                last_sync_error = NULL
            WHERE id = 1
        `);
    } catch (e) {
        const msg = (e as Error).message;
        await config.pg.execute(sql`
            UPDATE d4h_config SET
                last_sync_at = now(),
                last_sync_status = 'error',
                last_sync_error = ${msg.slice(0, 1000)}
            WHERE id = 1
        `).catch(() => undefined);
        return { ok: false, error: `Persist failed: ${msg}`, roster, warnings, stats };
    }

    return { ok: true, roster, warnings, stats };
}

export function clampSyncIntervalMinutes(n: unknown): number {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v)) return 60;
    return Math.min(1440, Math.max(15, Math.round(v)));
}

export function redactConfig(cfg: ServerD4HConfig | null): {
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
} {
    if (!cfg) {
        return {
            configured: false,
            tokenConfigured: false,
            defaultGroups: [],
            syncIntervalMinutes: 60,
        };
    }
    return {
        configured: true,
        tokenConfigured: !!cfg.token,
        region: cfg.region,
        baseUrl: cfg.baseUrl,
        context: cfg.context,
        contextId: cfg.contextId,
        defaultGroups: cfg.defaultGroups,
        syncIntervalMinutes: cfg.syncIntervalMinutes,
        lastSyncAt: cfg.lastSyncAt,
        lastSyncStatus: cfg.lastSyncStatus,
        lastSyncError: cfg.lastSyncError,
    };
}

export { asStringArray, textArraySql, query, asArray };
