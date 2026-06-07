// D4H API client — Phase 3 surface.
//
// Phase 0 spike confirmed:
//   - Host:           https://api.team-manager.<region>.d4h.com
//   - Path shape:     /v3/{context}/{contextId}/members
//   - CORS:           Allow-Origin: * (non-credentialed only — do NOT set
//                     credentials: 'include')
//   - Envelope:       { results: [...] }
//   - Member.id:      number
//
// Still [verify] (plan §8.3):
//   - Pagination cursor field names. We defensively loop with ?page=N&size=M and
//     stop when a page returns fewer results than requested. This works whether
//     the envelope carries explicit page/totalSize/next fields or not. The trade
//     is one wasted final request per sync.
//   - Equipment endpoint path — best guess: /v3/{ctx}/{id}/equipment
//   - Qualifications endpoint path — best guess: /v3/{ctx}/{id}/member-qualifications
//     with a fallback to /v3/{ctx}/{id}/qualification-awards
//   We treat 404 / 401-on-these-endpoints-only as a warning (sync still succeeds
//   for members), so the plugin doesn't break when a path turns out to differ.
//
// See docs/PLAN.md §3, §7, §8.

import { effectiveBaseUrl, type D4HConfig } from './d4h-config.ts';

export type ConnectionTestResult =
    | { ok: true;  sampleCount: number; firstName?: string; baseUrl: string }
    | { ok: false; status?: number;     error: string;       baseUrl: string };

interface PagedEnvelope<T> {
    results?: T[];
    // Field-name candidates we read defensively — D4H's actual cursor naming
    // is still [verify] per plan §8.3. The paginator only treats a *positive*
    // reported total as authoritative; 0 is treated as "no info".
    page?:        number;
    size?:        number;
    totalSize?:   number;
    total?:       number;
    totalCount?:  number;
    meta?:        { total?: number; totalSize?: number; totalCount?: number };
}

/** Pull a positive total out of whichever field D4H actually populates. */
function readReportedTotal(body: PagedEnvelope<unknown>): number | null {
    const candidates: Array<number | undefined> = [
        body.totalSize, body.total, body.totalCount,
        body.meta?.totalSize, body.meta?.total, body.meta?.totalCount,
    ];
    for (const n of candidates) {
        if (typeof n === 'number' && n > 0) return n;
    }
    return null;
}

type RawRecord = Record<string, unknown>;

/** Smallest possible round-trip that proves the token + context can read members. */
export async function testConnection(config: D4HConfig): Promise<ConnectionTestResult> {
    const baseUrl = effectiveBaseUrl(config);
    const url = `${baseUrl}/v3/${encodeURIComponent(config.context)}/${config.contextId}/members?size=1`;

    let res: Response;
    try {
        res = await fetch(url, {
            method:  'GET',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Accept':        'application/json',
            },
        });
    } catch (e) {
        return { ok: false, error: `Network error: ${(e as Error).message}`, baseUrl };
    }

    if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        return {
            ok:     false,
            status: res.status,
            error:  `HTTP ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
            baseUrl,
        };
    }

    let body: PagedEnvelope<{ id?: number; name?: string }>;
    try {
        body = await res.json() as PagedEnvelope<{ id?: number; name?: string }>;
    } catch (e) {
        return { ok: false, status: res.status, error: `Bad JSON: ${(e as Error).message}`, baseUrl };
    }

    const results = Array.isArray(body.results) ? body.results : [];
    return {
        ok:          true,
        sampleCount: results.length,
        firstName:   results[0]?.name?.trim(),
        baseUrl,
    };
}

// ─── Internals ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 100;     // D4H caps lower than 250; 100 matches observed cap
const MAX_PAGES         = 500;     // safety cap (50k records before bailing)

function authHeaders(config: D4HConfig): HeadersInit {
    return {
        'Authorization': `Bearer ${config.token}`,
        'Accept':        'application/json',
    };
}

function ctxPath(config: D4HConfig): string {
    return `/v3/${encodeURIComponent(config.context)}/${config.contextId}`;
}

export interface PaginatedFetchResult {
    records:  RawRecord[];
    pages:    number;     // pages actually fetched
    /** D4H-reported total when present, else null. Lets the UI sanity-check coverage. */
    reportedTotal: number | null;
    /** True when D4H accepted our server-side status filter; false if we fell back to fetch-all. */
    serverFiltered?: boolean;
}

/**
 * Generic paginated GET. Loops with ?page=N&size=M (1-based page), accumulating
 * `results`.
 *
 * Stop conditions (important — fixed after Phase 3 first-pass regression):
 *   1. The current page returned 0 results, OR
 *   2. body.totalSize is present and we've accumulated >= totalSize, OR
 *   3. We hit MAX_PAGES (safety cap)
 *
 * We deliberately do NOT stop on `results.length < pageSize` — D4H silently caps
 * `size` (observed: returns fewer rows than requested), and treating that as
 * "last page" terminated the loop after one request. The empty-page condition is
 * the only reliable stop for an envelope without a documented cursor.
 *
 * Throws on the first non-OK response — callers that want best-effort behavior
 * catch and convert to warnings.
 */
async function fetchAllPages(
    config:  D4HConfig,
    path:    string,
    options: { pageSize?: number; extraQuery?: Record<string, string | number> } = {},
): Promise<PaginatedFetchResult> {
    const baseUrl  = effectiveBaseUrl(config);
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const all: RawRecord[] = [];
    const seenIds = new Set<unknown>();
    let reportedTotal: number | null = null;
    let pagesFetched = 0;
    let consecutiveZeroNew = 0;
    // Tolerate sort-order jitter before giving up. D4H's listing returns
    // OVERLAPPING pages (default ordering isn't stable across requests), so a
    // run of all-already-seen pages can occur mid-stream while unseen records
    // still wait further down. A small tolerance (the old value was 3) trips on
    // that jitter and caps coverage early — this was the bug that stopped us at
    // 444/544. We start generous and, once D4H reports a total, scale the
    // tolerance to "enough extra sweeps of the whole list to shake jittered
    // records loose". MAX_PAGES still bounds worst-case work.
    let maxConsecutiveZeroNew = 12;

    // D4H list endpoints are 0-INDEXED. The original loop started at page=1,
    // which silently skipped the entire first page (records 0–99) — the cause
    // of the "short by exactly one page" symptom seen on BOTH members (444/544)
    // and equipment (285/385). Start at 0; fall back to 1-indexed only if a
    // deployment actually rejects page=0.
    let pageBase = 0;
    let exitReason = 'loop_max';

    for (let i = 0; i < MAX_PAGES; i++) {
        const page = pageBase + i;
        // D4H uses Zod for *strict* request validation — it 400s on any
        // unrecognized query param (observed: ZodError "unrecognized_keys" for
        // offset/limit). So we send only the keys D4H accepts: page + size.
        const params = new URLSearchParams({
            page: String(page),
            size: String(pageSize),
        });
        for (const [k, v] of Object.entries(options.extraQuery ?? {})) {
            params.set(k, String(v));
        }
        const url = `${baseUrl}${path}?${params.toString()}`;
        console.debug(`[d4h] GET ${url}`);

        // cache: 'no-store' prevents the browser from serving stale 304-cached
        // bodies — important because D4H returns different totals/results on
        // different runs and stale cache makes diagnostics worse.
        const res = await fetch(url, {
            method:  'GET',
            cache:   'no-store',
            headers: authHeaders(config),
        });
        if (!res.ok) {
            // D4H list endpoints are 0-indexed; if a deployment instead rejects
            // page=0 with a Zod 400, fall back to 1-indexed paging once and retry
            // this iteration so the first page is still captured.
            if (res.status === 400 && pageBase === 0 && i === 0) {
                console.debug(`[d4h] ${path} page=0 rejected (HTTP 400) — retrying 1-indexed.`);
                pageBase = 1;
                i--;
                continue;
            }
            // Surface D4H's structured Zod error verbatim — it tells us exactly
            // which query keys were rejected, which is how we discovered the
            // offset/limit issue. Truncate just enough to keep the UI readable.
            const detail = await res.text().catch(() => '');
            const err = new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 400)}`);
            (err as Error & { status?: number }).status = res.status;
            throw err;
        }

        const body = await res.json() as PagedEnvelope<RawRecord>;
        const results = Array.isArray(body.results) ? body.results : [];
        pagesFetched++;

        // Dedupe by id. D4H's listing has been observed to return OVERLAPPING
        // pages (likely default sort isn't stable across requests), so we tolerate
        // a few consecutive zero-new pages before stopping — see exit conditions.
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
            // Scale jitter tolerance to the dataset: we need ~ceil(total/pageSize)
            // pages of *fresh* data; allow roughly two full extra sweeps of
            // overlap on top of that before declaring a true plateau.
            maxConsecutiveZeroNew = Math.max(
                12,
                Math.ceil(reportedTotal / pageSize) * 2 + 5,
            );
        }

        const envelopeMeta = { ...(body as Record<string, unknown>) };
        delete envelopeMeta.results;
        console.debug(
            `[d4h] ${path} page ${page}: returned ${results.length} rows, ${newlyAdded} new ` +
            `(total so far ${all.length}${reportedTotal != null ? ` / ${reportedTotal}` : ''})`,
            envelopeMeta,
        );

        // ── Exit conditions, in priority order ───────────────────────────────
        if (results.length === 0) {
            exitReason = `empty_results_on_page_${page}`;
            console.debug(`[d4h] ${path} STOP: ${exitReason}`);
            break;
        }
        if (reportedTotal != null && all.length >= reportedTotal) {
            exitReason = `reached_reported_total_on_page_${page} (${all.length}/${reportedTotal})`;
            console.debug(`[d4h] ${path} STOP: ${exitReason}`);
            break;
        }
        if (newlyAdded === 0) {
            consecutiveZeroNew++;
            if (consecutiveZeroNew >= maxConsecutiveZeroNew) {
                exitReason =
                    `plateau_${consecutiveZeroNew}_consecutive_zero_new_pages ` +
                    `(last at ${page}, ${all.length}` +
                    `${reportedTotal != null ? `/${reportedTotal}` : ''} unique)`;
                console.debug(`[d4h] ${path} STOP: ${exitReason}`);
                break;
            }
            console.debug(
                `[d4h] ${path} page ${page} added 0 new (consecutive=${consecutiveZeroNew}/${maxConsecutiveZeroNew}) — continuing.`,
            );
        } else {
            consecutiveZeroNew = 0;
        }
    }

    console.debug(
        `[d4h] ${path} done: ${pagesFetched} pages, ${all.length} unique records, exit=${exitReason}`,
    );
    return { records: all, pages: pagesFetched, reportedTotal };
}

// ─── Public fetches ───────────────────────────────────────────────────────────

/** D4H status enum value for active members (matches the uppercase value in responses). */
const OPERATIONAL_STATUS = 'OPERATIONAL';

/**
 * Members, restricted to operational personnel.
 *
 * We "ask" D4H to filter server-side (`?status=OPERATIONAL`) so we transfer only
 * the records we want. D4H validates query params strictly (Zod), so if it rejects
 * the filter we fall back to an unfiltered fetch — the caller (syncNow) then enforces
 * operational-only client-side, so the result is identical either way. We also retry
 * unfiltered if the filter is *accepted* but matches nothing (guards against a param
 * that's silently interpreted differently than we expect).
 */
export async function fetchMembers(config: D4HConfig): Promise<PaginatedFetchResult> {
    const path = `${ctxPath(config)}/members`;
    try {
        const r = await fetchAllPages(config, path, {
            extraQuery: { status: OPERATIONAL_STATUS },
        });
        if (r.records.length === 0) {
            console.debug(`[d4h] members status=${OPERATIONAL_STATUS} returned 0 — retrying unfiltered.`);
            const all = await fetchAllPages(config, path);
            return { ...all, serverFiltered: false };
        }
        return { ...r, serverFiltered: true };
    } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 400) {
            console.debug(`[d4h] members status filter rejected (HTTP 400) — fetching unfiltered, filtering client-side.`);
            const all = await fetchAllPages(config, path);
            return { ...all, serverFiltered: false };
        }
        throw e;
    }
}

export interface BestEffortResult {
    records:        RawRecord[];
    pages:          number;        // 0 when warning fires
    reportedTotal:  number | null;
    warning?:       string;
}

/**
 * Equipment categories — id → title lookup. Equipment records reference their category
 * by id only (no title inline), so we fetch the category list separately. Best-effort:
 * tries the known path shapes and falls back to a warning so equipment still syncs.
 */
export async function fetchEquipmentCategories(config: D4HConfig): Promise<BestEffortResult> {
    const candidates = [
        `${ctxPath(config)}/equipment-categories`,
        `${ctxPath(config)}/equipment/categories`,
        `${ctxPath(config)}/equipment-category`,
    ];
    const errors: string[] = [];
    for (const path of candidates) {
        try {
            const r = await fetchAllPages(config, path);
            return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
        } catch (e) {
            const err = e as Error & { status?: number };
            errors.push(`${path}: ${err.message}`);
            if (err.status !== 404) break;
        }
    }
    return {
        records:       [],
        pages:         0,
        reportedTotal: null,
        warning:       `Equipment categories fetch failed — equipment will show category ids, not names. Tried: ${errors.join(' | ')}`,
    };
}

/**
 * Equipment brands — id → title lookup. List responses often embed brand as
 * `{ id, resourceType }` only (especially under model.brand); the title lives here.
 */
export async function fetchEquipmentBrands(config: D4HConfig): Promise<BestEffortResult> {
    const candidates = [
        `${ctxPath(config)}/equipment-brands`,
        `${ctxPath(config)}/equipment/brands`,
    ];
    const errors: string[] = [];
    for (const path of candidates) {
        try {
            const r = await fetchAllPages(config, path);
            return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
        } catch (e) {
            const err = e as Error & { status?: number };
            errors.push(`${path}: ${err.message}`);
            if (err.status !== 404) break;
        }
    }
    return {
        records:       [],
        pages:         0,
        reportedTotal: null,
        warning:       `Equipment brands fetch failed — Make column may be blank. Tried: ${errors.join(' | ')}`,
    };
}

/**
 * Equipment models — id → title (+ brandId) lookup when model is id-only on equipment rows.
 */
export async function fetchEquipmentModels(config: D4HConfig): Promise<BestEffortResult> {
    const candidates = [
        `${ctxPath(config)}/equipment-models`,
        `${ctxPath(config)}/equipment/models`,
    ];
    const errors: string[] = [];
    for (const path of candidates) {
        try {
            const r = await fetchAllPages(config, path);
            return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
        } catch (e) {
            const err = e as Error & { status?: number };
            errors.push(`${path}: ${err.message}`);
            if (err.status !== 404) break;
        }
    }
    return {
        records:       [],
        pages:         0,
        reportedTotal: null,
        warning:       `Equipment models fetch failed — Model/Make may be incomplete. Tried: ${errors.join(' | ')}`,
    };
}

/** Equipment — best-effort: a non-200 becomes a warning, members still sync. */
export async function fetchEquipment(config: D4HConfig): Promise<BestEffortResult> {
    try {
        const r = await fetchAllPages(config, `${ctxPath(config)}/equipment`);
        return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
    } catch (e) {
        return {
            records:       [],
            pages:         0,
            reportedTotal: null,
            warning:       `Equipment fetch failed (${(e as Error).message}). Endpoint path may differ — see plan §8.3.`,
        };
    }
}

/**
 * Qualifications — best-effort with one fallback. Tries the modern member-qualifications
 * path first; if it 404s, retries the older qualification-awards shape.
 */
/** Try each candidate path in order; first one that returns wins, else a warning. */
async function fetchFromCandidates(
    config: D4HConfig, candidates: string[], label: string,
): Promise<BestEffortResult> {
    const errors: string[] = [];
    for (const path of candidates) {
        try {
            const r = await fetchAllPages(config, path);
            return { records: r.records, pages: r.pages, reportedTotal: r.reportedTotal };
        } catch (e) {
            const err = e as Error & { status?: number };
            errors.push(`${path}: ${err.message}`);
            if (err.status !== 404) break;
        }
    }
    return { records: [], pages: 0, reportedTotal: null, warning: `${label} fetch failed. Tried: ${errors.join(' | ')}` };
}

/** Qualification CATALOG — the definitions (id → title). No member links. */
export async function fetchQualificationCatalog(config: D4HConfig): Promise<BestEffortResult> {
    return fetchFromCandidates(config, [
        `${ctxPath(config)}/member-qualifications`,
        `${ctxPath(config)}/qualifications`,
    ], 'Qualification catalog');
}

/** Qualification AWARDS — the member→qualification links (with start/end dates). */
export async function fetchQualificationAwards(config: D4HConfig): Promise<BestEffortResult> {
    return fetchFromCandidates(config, [
        `${ctxPath(config)}/member-qualification-awards`,
        `${ctxPath(config)}/qualification-awards`,
    ], 'Qualification awards');
}

// ─── Writes (Phase: submit incident) ───────────────────────────────────────────
//
// Phase-0 CORS spike (2026-06-06, real OPTIONS from cloudtak.example.org) confirmed
// D4H returns `Access-Control-Allow-Origin: *` and
// `Access-Control-Allow-Methods: GET,HEAD,PUT,PATCH,POST,DELETE` with
// `Access-Control-Allow-Headers: authorization,content-type`. So browser writes are
// allowed cross-origin — no server proxy needed for CORS.
//
// IMPORTANT: because Allow-Origin is the wildcard `*`, requests must stay
// NON-credentialed — do NOT set `credentials: 'include'` (a wildcard origin and
// credentialed mode are mutually exclusive). The Bearer token in the Authorization
// header is what authenticates; we never rely on cookies.

/** Some D4H write endpoints (incidents reference, attendance, involved-*) are team-scoped only. */
function teamPath(config: D4HConfig): string {
    return `/v3/team/${config.contextId}`;
}

function writeHeaders(config: D4HConfig): HeadersInit {
    return {
        'Authorization': `Bearer ${config.token}`,
        'Accept':        'application/json',
        'Content-Type':  'application/json',
    };
}

/**
 * Generic JSON write (POST/PATCH). Mirrors the read path's error handling: surfaces
 * D4H's structured Zod validation error verbatim (it names the rejected keys), and
 * tags the thrown Error with `.status` so callers can branch (e.g. 401 → bad token,
 * 409 → reference taken). Non-credentialed by design (see note above).
 */
async function writeJson<T = unknown>(
    config: D4HConfig,
    path:   string,
    body:   unknown,
    method: 'POST' | 'PATCH' = 'POST',
): Promise<T> {
    const url = `${effectiveBaseUrl(config)}${path}`;
    console.debug(`[d4h] ${method} ${url}`);

    const res = await fetch(url, {
        method,
        cache:   'no-store',
        headers: writeHeaders(config),
        body:    JSON.stringify(body ?? {}),
        // NOTE: intentionally no `credentials` — wildcard CORS forbids it.
    });

    const text = await res.text().catch(() => '');
    let parsed: unknown = undefined;
    if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }

    if (!res.ok) {
        const detail = typeof parsed === 'string'
            ? parsed
            : JSON.stringify(parsed ?? {});
        const err = new Error(`HTTP ${res.status} ${res.statusText} — ${detail.slice(0, 400)}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
    }

    return parsed as T;
}

/** The D4H incident-create request body (v1 subset — see docs/PLAN-submit-incident.md). */
export interface D4HIncidentCreate {
    reference?:            string;        // only if team has activity auto-id enabled
    referenceDescription?: string;        // the incident TITLE (max 100)
    description?:          string | null; // HTML, the long text box
    plan?:                 string | null;
    trackingNumber?:       string | null;
    shared?:               boolean;
    fullTeam?:             boolean;
    address?: {
        country?:  string;
        postcode?: string;
        region?:   string;
        street?:   string;
        town?:     string;
    };
    location?: {
        latitude:  number;   // both required *within* location when present
        longitude: number;
    };
    locationBookmarkId?: number;
    startsAt:  string;       // REQUIRED — ISO 8601, emit UTC (…Z)
    endsAt?:   string;
    customFieldValues?: Array<{ id: number; value: number[] | string | null }>;
}

/** A member group as needed by the (non-full-team) multi-select. */
export interface MemberGroupOption {
    id:    number;
    title: string;
}

/**
 * Peek the next available auto-id reference WITHOUT consuming it.
 * Team has auto-id enabled (confirmed with Paul), so the create payload should carry
 * a reference. `peek` has no side effect. Team-scoped endpoint.
 *
 * The v3 response shape isn't documented in the swagger; we parse defensively and
 * return the reference string, or null if we can't find one (caller may then omit
 * `reference` and let D4H auto-assign).
 */
export async function peekIncidentReference(config: D4HConfig): Promise<string | null> {
    if (config.context !== 'team') return null; // reference/peek is team-only
    const body = await writeJson<unknown>(config, `${teamPath(config)}/incidents/reference/peek`, {});
    if (typeof body === 'string') return body.trim() || null;
    if (body && typeof body === 'object') {
        const o = body as Record<string, unknown>;
        for (const k of ['reference', 'value', 'next', 'nextReference']) {
            if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim();
        }
    }
    return null;
}

/**
 * Create an incident. Returns the created record (parsed JSON) — callers read its
 * `id`/`activityId` for follow-up steps (attendance, involved-persons) in later phases.
 * Endpoint accepts either team or org context: /v3/{context}/{contextId}/incidents.
 */
export async function createIncident(
    config: D4HConfig,
    payload: D4HIncidentCreate,
): Promise<Record<string, unknown>> {
    return writeJson<Record<string, unknown>>(config, `${ctxPath(config)}/incidents`, payload);
}

/**
 * Member groups for the (fullTeam=false) multi-select. Returns only `{ id, title }`.
 * GET — reuses the paginated read path. v1 just needs the list to render the picker.
 */
export async function listMemberGroups(config: D4HConfig): Promise<MemberGroupOption[]> {
    const r = await fetchAllPages(config, `${ctxPath(config)}/member-groups`);
    return r.records
        .map((rec) => {
            const o = rec as Record<string, unknown>;
            const id = typeof o.id === 'number' ? o.id : Number(o.id);
            const title = typeof o.title === 'string' ? o.title : '';
            return { id, title };
        })
        .filter((g) => Number.isFinite(g.id) && g.title !== '');
}

// ─── Custom fields (incident) ──────────────────────────────────────────────────

/** D4H custom-field input types (from POST /custom-fields `type` enum). */
export type D4HCustomFieldType =
    | 'DATE' | 'DATETIME' | 'TIME'
    | 'NUMBER' | 'TEXT' | 'TEXT_AREA'
    | 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE';

export interface D4HCustomFieldOption {
    id:    number;
    label: string;
}

export interface D4HCustomField {
    id:        number;
    title:     string;
    type:      D4HCustomFieldType;
    hint?:     string;
    mandatory: boolean;
    /** Populated for SINGLE_CHOICE / MULTIPLE_CHOICE; empty otherwise. */
    options:   D4HCustomFieldOption[];
}

const CHOICE_TYPES: ReadonlySet<string> = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE']);

/**
 * Incident custom-field definitions for the dynamic form. Filters server-side to
 * `target_resource_type=Incident`; drops archived fields client-side (the `archived`
 * query param's accepted type isn't documented, so we don't risk a Zod 400 on it).
 * Choice options are read from each field's embedded `options[]`.
 */
export async function listIncidentCustomFields(config: D4HConfig): Promise<D4HCustomField[]> {
    const r = await fetchAllPages(config, `${ctxPath(config)}/custom-fields`, {
        extraQuery: { target_resource_type: 'Incident', sort: 'ordering', order: 'asc' },
    });

    const out: D4HCustomField[] = [];
    for (const rec of r.records) {
        const o = rec as Record<string, unknown>;
        if (o.archived === true) continue;

        const id = typeof o.id === 'number' ? o.id : Number(o.id);
        const type = String(o.type ?? '') as D4HCustomFieldType;
        if (!Number.isFinite(id) || !type) continue;

        const rawOptions = Array.isArray(o.options) ? o.options : [];
        const options: D4HCustomFieldOption[] = CHOICE_TYPES.has(type)
            ? rawOptions
                .map((op) => {
                    const oo = op as Record<string, unknown>;
                    const oid = typeof oo.id === 'number' ? oo.id : Number(oo.id);
                    const label = String(oo.label ?? oo.title ?? oid);
                    return { id: oid, label };
                })
                .filter((op) => Number.isFinite(op.id))
            : [];

        out.push({
            id,
            title:     String(o.title ?? `Field ${id}`),
            type,
            hint:      typeof o.hint === 'string' && o.hint ? o.hint : undefined,
            mandatory: o.mandatory === true || o.mandatory === 'true',
            options,
        });
    }
    return out;
}
