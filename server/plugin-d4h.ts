// CloudTAK server route for hybrid D4H persistence.
//
// Install: copy server/*.ts → api/stateless/routes/ and rebuild the API image.
// Requires CloudTAK 13.124+ (API OXLint). Callers use the Authorization header
// via std(); these routes do not accept ?token=.
// Provides Postgres-backed roster + group-filtered GET endpoints + admin sync.
// Periodic sync runs in-process from d4h_config.sync_interval_minutes (single-replica).

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';
import { TAKAPI, APIAuthCertificate } from '@tak-ps/node-tak';
import {
    asArray,
    asStringArray,
    clampSyncIntervalMinutes,
    loadServerConfig,
    query,
    redactConfig,
    runD4HSync,
    textArraySql,
    type D4HEquipment,
    type D4HExternalResource,
    type D4HIncident,
    type D4HMember,
    type D4HRoster,
    type D4HRosterMeta,
    type ServerD4HConfig,
    type SyncResult,
} from './d4h-sync.js';

let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncInFlight = false;

async function bootstrapTables(config: ConfigStateless): Promise<void> {
    try {
        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS d4h_config (
                id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                region TEXT NOT NULL DEFAULT 'us',
                base_url TEXT,
                context TEXT NOT NULL DEFAULT 'team',
                context_id INTEGER NOT NULL DEFAULT 0,
                token TEXT NOT NULL DEFAULT '',
                default_groups TEXT[] NOT NULL DEFAULT '{}',
                sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
                last_sync_at TIMESTAMPTZ,
                last_sync_status TEXT,
                last_sync_error TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await config.pg.execute(sql`
            INSERT INTO d4h_config (id) VALUES (1)
            ON CONFLICT (id) DO NOTHING
        `);

        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS d4h_members (
                id INTEGER PRIMARY KEY,
                ref TEXT,
                name TEXT NOT NULL,
                callsign TEXT,
                position TEXT,
                status TEXT,
                email TEXT,
                mobile TEXT,
                phone TEXT,
                qualifications JSONB NOT NULL DEFAULT '[]'::jsonb,
                groups TEXT[] NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await config.pg.execute(sql`
            CREATE INDEX IF NOT EXISTS d4h_members_ref_idx ON d4h_members (ref)
        `);
        await config.pg.execute(sql`
            CREATE INDEX IF NOT EXISTS d4h_members_groups_idx ON d4h_members USING GIN (groups)
        `);

        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS d4h_equipment (
                id INTEGER PRIMARY KEY,
                ref TEXT,
                name TEXT NOT NULL,
                make TEXT,
                model TEXT,
                brand_id INTEGER,
                model_id INTEGER,
                category_id INTEGER,
                category TEXT,
                status TEXT,
                groups TEXT[] NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await config.pg.execute(sql`
            CREATE INDEX IF NOT EXISTS d4h_equipment_groups_idx ON d4h_equipment USING GIN (groups)
        `);

        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS d4h_external_resources (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                groups TEXT[] NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS d4h_incidents (
                id INTEGER PRIMARY KEY,
                reference TEXT,
                title TEXT NOT NULL,
                starts_at TIMESTAMPTZ,
                ends_at TIMESTAMPTZ,
                tracking_number TEXT,
                description TEXT,
                published BOOLEAN,
                mission_guid TEXT,
                groups TEXT[] NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);

        await config.pg.execute(sql`
            CREATE TABLE IF NOT EXISTS d4h_meta (
                id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await config.pg.execute(sql`
            INSERT INTO d4h_meta (id) VALUES (1)
            ON CONFLICT (id) DO NOTHING
        `);
    } catch (err) {
        console.error('[d4h] table bootstrap failed', err);
    }
}

interface CallerAccess {
    isAdmin: boolean;
    groups: string[];
}

async function resolveCallerAccess(
    config: ConfigStateless,
    req: Parameters<typeof Auth.as_user>[1],
): Promise<CallerAccess> {
    const user = await Auth.as_user(config, req);
    const profile = await config.models.Profile.from(user.email);
    const isAdmin = profile.system_admin || profile.agency_admin.length > 0;

    if (isAdmin) return { isAdmin: true, groups: [] };

    const auth = profile.auth;
    if (!auth?.cert || !auth.key) {
        return { isAdmin: false, groups: [] };
    }

    try {
        const api = await TAKAPI.init(
            new URL(String(config.server.api)),
            new APIAuthCertificate(auth.cert, auth.key),
        );
        const groups = (await api.Group.list({ useCache: true })).data
            .filter((g) => g.active)
            .map((g) => g.name);
        return { isAdmin: false, groups };
    } catch (err) {
        console.error('[d4h] group resolution failed', err);
        return { isAdmin: false, groups: [] };
    }
}

function visibleByGroups<T extends { groups?: string[] }>(
    rows: T[],
    access: CallerAccess,
): T[] {
    if (access.isAdmin) return rows;
    if (!access.groups.length) return [];
    return rows.filter((r) => (r.groups ?? []).some((g) => access.groups.includes(g)));
}

type DbText = string | number | boolean | Date | null;

function dbText(value: DbText): string | undefined {
    if (value == null) return undefined;
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

interface MemberRow {
    id: number | string;
    ref: DbText;
    name: DbText;
    callsign: DbText;
    position: DbText;
    status: DbText;
    email: DbText;
    mobile: DbText;
    phone: DbText;
    qualifications: unknown;
    groups: unknown;
}

interface EquipmentRow {
    id: number | string;
    ref: DbText;
    name: DbText;
    make: DbText;
    model: DbText;
    brand_id: number | string | null;
    model_id: number | string | null;
    category_id: number | string | null;
    category: DbText;
    status: DbText;
    groups: unknown;
}

interface ResourceRow {
    id: number | string;
    name: DbText;
    groups: unknown;
}

interface IncidentRow {
    id: number | string;
    reference: DbText;
    title: DbText;
    starts_at: DbText;
    ends_at: DbText;
    tracking_number: DbText;
    description: DbText;
    published: boolean | null;
    mission_guid: DbText;
    groups: unknown;
}

function mapMember(row: MemberRow): D4HMember {
    return {
        id: Number(row.id),
        ref: dbText(row.ref),
        name: dbText(row.name) ?? '',
        callsign: dbText(row.callsign),
        position: dbText(row.position),
        status: dbText(row.status),
        email: dbText(row.email),
        mobile: dbText(row.mobile),
        phone: dbText(row.phone),
        qualifications: asQualifications(row.qualifications),
        groups: asStringArray(row.groups),
    };
}

function asQualifications(value: unknown): D4HMember['qualifications'] {
    const out: NonNullable<D4HMember['qualifications']> = [];
    for (const item of asArray(value)) {
        if (!item || typeof item !== 'object') continue;
        const q = item as Record<string, unknown>;
        const id = typeof q.id === 'number' ? q.id : (typeof q.id === 'string' ? Number(q.id) : Number.NaN);
        const name = typeof q.name === 'string' ? q.name : '';
        if (!Number.isFinite(id) || !name) continue;
        const expiresAt = typeof q.expiresAt === 'string' ? q.expiresAt : undefined;
        const memberId = typeof q.memberId === 'number' ? q.memberId : undefined;
        out.push({ id, name, expiresAt, memberId });
    }
    return out;
}

function mapEquipment(row: EquipmentRow): D4HEquipment {
    return {
        id: Number(row.id),
        ref: dbText(row.ref),
        name: dbText(row.name) ?? '',
        make: dbText(row.make),
        model: dbText(row.model),
        brandId: row.brand_id != null ? Number(row.brand_id) : undefined,
        modelId: row.model_id != null ? Number(row.model_id) : undefined,
        categoryId: row.category_id != null ? Number(row.category_id) : undefined,
        category: dbText(row.category),
        status: dbText(row.status),
        groups: asStringArray(row.groups),
    };
}

function mapResource(row: ResourceRow): D4HExternalResource {
    return {
        id: Number(row.id),
        name: dbText(row.name) ?? '',
        groups: asStringArray(row.groups),
    };
}

function mapIncident(row: IncidentRow): D4HIncident {
    return {
        id: Number(row.id),
        reference: dbText(row.reference),
        title: dbText(row.title) ?? '',
        startsAt: dbText(row.starts_at),
        endsAt: dbText(row.ends_at),
        trackingNumber: dbText(row.tracking_number),
        description: dbText(row.description),
        published: typeof row.published === 'boolean' ? row.published : undefined,
        missionGuid: dbText(row.mission_guid),
        groups: asStringArray(row.groups),
    };
}

function parseJson(value: string): unknown {
    return JSON.parse(value) as unknown;
}

async function loadMeta(config: ConfigStateless): Promise<D4HRosterMeta | null> {
    const rows = await query<{ payload: unknown }>(config, sql`SELECT payload FROM d4h_meta WHERE id = 1`);
    const stored = rows[0]?.payload;
    if (stored == null) return null;
    let payload: unknown = stored;
    if (typeof payload === 'string') {
        try {
            payload = parseJson(payload);
        } catch {
            // Stored payload is not JSON; treat meta as missing.
            return null;
        }
    }
    if (!payload || typeof payload !== 'object') return null;
    return payload as D4HRosterMeta;
}

async function loadFilteredRoster(config: ConfigStateless, access: CallerAccess): Promise<D4HRoster> {
    const memberRows = await query<MemberRow>(config, sql`
        SELECT id, ref, name, callsign, position, status, email, mobile, phone, qualifications, groups
        FROM d4h_members ORDER BY name ASC
    `);
    const equipmentRows = await query<EquipmentRow>(config, sql`
        SELECT id, ref, name, make, model, brand_id, model_id, category_id, category, status, groups
        FROM d4h_equipment ORDER BY name ASC
    `);
    const resourceRows = await query<ResourceRow>(config, sql`
        SELECT id, name, groups FROM d4h_external_resources ORDER BY name ASC
    `);
    const incidentRows = await query<IncidentRow>(config, sql`
        SELECT id, reference, title, starts_at, ends_at, tracking_number, description,
               published, mission_guid, groups
        FROM d4h_incidents ORDER BY starts_at DESC NULLS LAST
    `);

    const members = visibleByGroups(memberRows.map(mapMember), access);
    const equipment = visibleByGroups(equipmentRows.map(mapEquipment), access);
    const externalResources = visibleByGroups(resourceRows.map(mapResource), access);
    const incidents = visibleByGroups(incidentRows.map(mapIncident), access);
    const storedMeta = await loadMeta(config);

    const meta: D4HRosterMeta = {
        fetchedAt: storedMeta?.fetchedAt ?? new Date(0).toISOString(),
        region: storedMeta?.region ?? '',
        context: storedMeta?.context ?? '',
        contextId: storedMeta?.contextId ?? 0,
        contextName: storedMeta?.contextName,
        memberCount: members.length,
        equipmentCount: equipment.length,
        externalResourceCount: externalResources.length,
        incidentCount: incidents.length,
        equipmentCategories: storedMeta?.equipmentCategories,
        warnings: storedMeta?.warnings ?? [],
    };

    return { meta, members, equipment, externalResources, incidents };
}

function refFromCallsign(callsign: string): string | null {
    const m = callsign.match(/(\d{3})\D*$/);
    return m ? m[1] : null;
}

function normRef(s?: string): string {
    return String(s ?? '').replace(/^0+/, '');
}

async function doSync(config: ConfigStateless): Promise<SyncResult> {
    if (syncInFlight) {
        return {
            ok: false,
            error: 'Sync already in progress',
            warnings: [],
            stats: {
                members: { pages: 0, rawCount: 0, reportedTotal: null },
                equipment: { pages: 0, rawCount: 0, reportedTotal: null },
                qualifications: { pages: 0, rawCount: 0, reportedTotal: null },
                externalResources: { queriesRun: 0, pages: 0, rawCount: 0 },
                incidents: { pages: 0, rawCount: 0, reportedTotal: null },
            },
        };
    }
    syncInFlight = true;
    try {
        const cfg = await loadServerConfig(config);
        if (!cfg) {
            return {
                ok: false,
                error: 'Server D4H config not set (token missing)',
                warnings: [],
                stats: {
                    members: { pages: 0, rawCount: 0, reportedTotal: null },
                    equipment: { pages: 0, rawCount: 0, reportedTotal: null },
                    qualifications: { pages: 0, rawCount: 0, reportedTotal: null },
                    externalResources: { queriesRun: 0, pages: 0, rawCount: 0 },
                    incidents: { pages: 0, rawCount: 0, reportedTotal: null },
                },
            };
        }
        return await runD4HSync(config, cfg);
    } finally {
        syncInFlight = false;
    }
}

function stopPeriodicSync(): void {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

async function startPeriodicSync(config: ConfigStateless): Promise<void> {
    stopPeriodicSync();
    const cfg = await loadServerConfig(config);
    if (!cfg?.token) return;
    const minutes = clampSyncIntervalMinutes(cfg.syncIntervalMinutes);
    const ms = minutes * 60 * 1000;
    console.log(`[d4h] periodic sync every ${minutes}m (single-replica in-process timer)`);
    syncTimer = setInterval(() => {
        doSync(config).then((r) => {
            if (!r.ok) console.error('[d4h] periodic sync failed:', r.error);
            else console.log(`[d4h] periodic sync ok — ${r.roster?.meta.memberCount ?? 0} members`);
        }).catch((err) => console.error('[d4h] periodic sync threw', err));
    }, ms);
    // Don't block startup on an immediate sync; first tick waits one interval.
    // Admins can POST /api/d4h/sync, or external cron can hit the same endpoint.
}

export default async function router(schema: Schema, config: ConfigStateless): Promise<void> {
    await bootstrapTables(config);
    await startPeriodicSync(config);

    await schema.get('/d4h/config', {
        name: 'Get D4H server config',
        group: 'D4H',
        description: 'Redacted server-side D4H config (no token value)',
        security: Auth.security({}),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            // Even with empty token, return the row fields for the form.
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
            if (!row) {
                res.json(redactConfig(null));
                return;
            }
            const full: ServerD4HConfig = {
                region: row.region as ServerD4HConfig['region'],
                baseUrl: row.base_url,
                context: row.context as ServerD4HConfig['context'],
                contextId: Number(row.context_id),
                token: row.token || '',
                defaultGroups: asStringArray(row.default_groups),
                syncIntervalMinutes: Number(row.sync_interval_minutes) || 60,
                lastSyncAt: row.last_sync_at,
                lastSyncStatus: row.last_sync_status,
                lastSyncError: row.last_sync_error,
            };
            res.json({
                ...redactConfig(full.token ? full : { ...full, token: '' }),
                // expose configured even when token empty so UI can edit
                configured: true,
                tokenConfigured: !!row.token,
                available: true,
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.put('/d4h/config', {
        name: 'Update D4H server config',
        group: 'D4H',
        description: 'Admin-only: save server D4H credentials, interval, default TAK groups',
        body: Type.Object({
            region: Type.Optional(Type.String()),
            baseUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])),
            context: Type.Optional(Type.String()),
            contextId: Type.Optional(Type.Integer()),
            token: Type.Optional(Type.String()),
            defaultGroups: Type.Optional(Type.Array(Type.String())),
            syncIntervalMinutes: Type.Optional(Type.Integer()),
            clearToken: Type.Optional(Type.Boolean()),
        }),
        security: Auth.security({ admin: true }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req, { admin: true });
            const body = req.body as {
                region?: string;
                baseUrl?: string | null;
                context?: string;
                contextId?: number;
                token?: string;
                defaultGroups?: string[];
                syncIntervalMinutes?: number;
                clearToken?: boolean;
            };

            const existing = await query<{ token: string }>(config, sql`
                SELECT token FROM d4h_config WHERE id = 1
            `);
            let nextToken = existing[0]?.token ?? '';
            if (body.clearToken) nextToken = '';
            else if (typeof body.token === 'string' && body.token.trim()) nextToken = body.token.trim();

            const region = (body.region ?? 'us').trim() || 'us';
            const context = (body.context ?? 'team').trim() || 'team';
            const contextId = Number(body.contextId ?? 0);
            const baseUrl = body.baseUrl != null ? String(body.baseUrl).trim() || null : null;
            const groups = Array.isArray(body.defaultGroups)
                ? body.defaultGroups.map(String).map((g) => g.trim()).filter(Boolean)
                : [];
            const interval = clampSyncIntervalMinutes(body.syncIntervalMinutes ?? 60);

            await config.pg.execute(sql`
                INSERT INTO d4h_config (
                    id, region, base_url, context, context_id, token, default_groups,
                    sync_interval_minutes, updated_at
                ) VALUES (
                    1, ${region}, ${baseUrl}, ${context}, ${contextId}, ${nextToken},
                    ${textArraySql(groups)}, ${interval}, now()
                )
                ON CONFLICT (id) DO UPDATE SET
                    region = EXCLUDED.region,
                    base_url = EXCLUDED.base_url,
                    context = EXCLUDED.context,
                    context_id = EXCLUDED.context_id,
                    token = EXCLUDED.token,
                    default_groups = EXCLUDED.default_groups,
                    sync_interval_minutes = EXCLUDED.sync_interval_minutes,
                    updated_at = now()
            `);

            await startPeriodicSync(config);
            const cfg = await loadServerConfig(config);
            res.json({
                ...redactConfig(cfg ?? {
                    region: region as ServerD4HConfig['region'],
                    baseUrl,
                    context: context as ServerD4HConfig['context'],
                    contextId,
                    token: nextToken,
                    defaultGroups: groups,
                    syncIntervalMinutes: interval,
                }),
                available: true,
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/d4h/sync', {
        name: 'Sync D4H roster',
        group: 'D4H',
        description: 'Admin-only: pull from D4H into Postgres (also usable by external cron)',
        security: Auth.security({ admin: true }),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req, { admin: true });
            const result = await doSync(config);
            await startPeriodicSync(config);
            if (!result.ok) {
                res.status(result.error?.includes('already in progress') ? 409 : 502).json(result);
                return;
            }
            res.json(result);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/d4h/roster', {
        name: 'Get D4H roster',
        group: 'D4H',
        description: 'Group-filtered full roster for the plugin UI',
        security: Auth.security({}),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const access = await resolveCallerAccess(config, req);
            const roster = await loadFilteredRoster(config, access);
            res.json(roster);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/d4h/members', {
        name: 'List D4H members',
        group: 'D4H',
        description: 'Group-filtered members; optional ?ref= or ?callsign=',
        query: Type.Object({
            ref: Type.Optional(Type.String()),
            callsign: Type.Optional(Type.String()),
        }),
        security: Auth.security({}),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const access = await resolveCallerAccess(config, req);
            const rows = await query<MemberRow>(config, sql`
                SELECT id, ref, name, callsign, position, status, email, mobile, phone, qualifications, groups
                FROM d4h_members ORDER BY name ASC
            `);
            let members = visibleByGroups(rows.map(mapMember), access);

            const q = req.query as { ref?: string; callsign?: string };
            if (q.ref) {
                const want = normRef(q.ref);
                members = members.filter((m) => normRef(m.ref) === want);
            } else if (q.callsign) {
                const want = normRef(refFromCallsign(q.callsign) ?? '');
                if (!want) members = [];
                else members = members.filter((m) => normRef(m.ref) === want);
            }

            res.json({ members });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/d4h/equipment', {
        name: 'List D4H equipment',
        group: 'D4H',
        description: 'Group-filtered equipment',
        security: Auth.security({}),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            const access = await resolveCallerAccess(config, req);
            const rows = await query<EquipmentRow>(config, sql`
                SELECT id, ref, name, make, model, brand_id, model_id, category_id, category, status, groups
                FROM d4h_equipment ORDER BY name ASC
            `);
            res.json({ equipment: visibleByGroups(rows.map(mapEquipment), access) });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/d4h/meta', {
        name: 'Get D4H sync meta',
        group: 'D4H',
        description: 'Last sync header / warnings',
        security: Auth.security({}),
        res: Type.Any(),
    }, async (req, res) => {
        try {
            await Auth.is_auth(config, req);
            const meta = await loadMeta(config);
            const cfg = await loadServerConfig(config);
            res.json({
                meta,
                server: redactConfig(cfg),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
