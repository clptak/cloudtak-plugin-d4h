// Raw D4H record → normalized plugin shape.
//
// Source shapes (observed in Phase 0 spike against /v3/team/12345/members):
//   {
//     id: 19397,
//     ref: "629",
//     name: "Example, Member ",
//     position: "Retired at own Request",
//     status: "RETIRED",
//     email:  { value: "...", verified: false },
//     mobile: { phone: "...", verified: false },
//     home:   { phone: "", verified: false },
//     work:   { phone: "" },
//     owner:  { id: 12345, resourceType: "Team" },
//     customFieldValues: [ { customField: {...}, value: "..." } ],
//     // ...lots more
//   }
//
// We accept extra fields silently (D4H adds them; we don't care). We only fail loudly
// if id/name are missing, because those are the keys that make a member useful at all.

import type { D4HMember, D4HEquipment, D4HIncident, D4HStatus } from './d4h-types.ts';

type Json = Record<string, unknown>;

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

export function normalizeMember(raw: Json): D4HMember | null {
    const id = num(raw.id);
    const name = str(raw.name);
    if (id === undefined || !name) return null;

    const email  = nestedString(raw.email, 'value');
    const mobile = nestedString(raw.mobile, 'phone');
    const phone =
        mobile ??
        nestedString(raw.work, 'phone') ??
        nestedString(raw.home, 'phone');

    const statusRaw = str(raw.status);
    const status: D4HStatus | undefined = statusRaw as D4HStatus | undefined;

    return {
        id,
        ref:      str(raw.ref),
        name,
        position: str(raw.position),
        status,
        email,
        mobile,
        phone,
    };
}

export function normalizeEquipment(raw: Json): D4HEquipment | null {
    // Only `id` is required. D4H equipment records (verified Phase 4) carry NO top-level
    // name — the human label is the equipment *kind* title (e.g. "NIGHT VISION MONOCULAR").
    const id = num(raw.id);
    if (id === undefined) return null;

    const name =
        nestedString(raw.kind,  'title') ??
        str(raw.name) ??
        str(raw.title) ??
        str(raw.ref) ??
        `Equipment ${id}`;

    const brandId =
        num((raw.brand as Json | undefined)?.id) ??
        num(((raw.model as Json | undefined)?.brand as Json | undefined)?.id);

    const modelId = num((raw.model as Json | undefined)?.id);

    // Top-level brand often has title; model.brand is frequently id-only on list responses.
    const make =
        fieldString(raw, 'brand') ??
        fieldString(raw.model, 'brand') ??
        fieldString(raw.kind, 'brand') ??
        fieldString(raw, 'manufacturer') ??
        str(raw.make);

    const model =
        nestedString(raw.model, 'title') ??
        nestedString(raw.model, 'name');

    // Category is referenced by id only ({ resourceType, id }); the title lives in the
    // separate EquipmentCategory list and is resolved in syncNow. Read the id from the
    // record's own category, falling back to the kind's category.
    const categoryId =
        num((raw.category as Json | undefined)?.id) ??
        num(((raw.kind as Json | undefined)?.category as Json | undefined)?.id);

    // Keep an inline title if some other endpoint shape ever provides one.
    const category =
        nestedString(raw.category, 'title') ??
        nestedString(raw.category, 'name');

    return {
        id,
        ref:        str(raw.ref),
        name,
        make,
        model,
        brandId,
        modelId,
        categoryId,
        category,
        status:     str(raw.status) ?? nestedString(raw.status, 'name'),
    };
}

/** EquipmentCategory record → { id, title } for the id→title lookup. */
export function normalizeEquipmentCategory(raw: Json): { id: number; title: string } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    return { id, title };
}

/** EquipmentBrand record → { id, title } for the id→title lookup. */
export function normalizeEquipmentBrand(raw: Json): { id: number; title: string } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    return { id, title };
}

/** EquipmentModel record → { id, title, brandId? } for lookups. */
export function normalizeEquipmentModel(raw: Json): { id: number; title: string; brandId?: number } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    const brandId =
        num((raw.brand as Json | undefined)?.id) ??
        num(raw.brandId);
    return { id, title, brandId };
}

/** Qualification catalog entry (MemberQualification) → { id, title }. */
export function normalizeQualificationDef(raw: Json): { id: number; title: string } | null {
    const id = num(raw.id);
    const title = str(raw.title) ?? str(raw.name);
    if (id === undefined || !title) return null;
    return { id, title };
}

/**
 * Qualification AWARD (MemberQualificationAward) → the member→qualification link.
 * Title is NOT on the award (only `qualification.id`); it's resolved from the catalog
 * in syncNow. Expiry is D4H's `endsAt`.
 */
export function normalizeQualificationAward(
    raw: Json,
): { id: number; memberId: number; qualId?: number; expiresAt?: string } | null {
    const id = num(raw.id);
    const memberId =
        num((raw.member as Json | undefined)?.id) ??
        num(raw.memberId);
    if (id === undefined || memberId === undefined) return null;

    const qualId =
        num((raw.qualification as Json | undefined)?.id) ??
        num(raw.qualificationId);
    const expiresAt =
        str(raw.endsAt) ?? str(raw.expiresAt) ?? str(raw.expires_at) ?? str(raw.expiry);

    return { id, memberId, qualId, expiresAt };
}

/**
 * Build a roster incident row from a POST /incidents response (uses `activityId` when `id` absent).
 * Optional `seed` fills gaps from the submit form (title, times, mission link).
 */
export function incidentFromCreateResponse(
    created: Record<string, unknown>,
    seed?: Partial<D4HIncident>,
): D4HIncident | null {
    const activityId = num(created.activityId);
    const withId = created.id != null
        ? created
        : activityId != null
            ? { ...created, id: activityId }
            : created;
    const normalized = normalizeIncident(withId as Json);
    if (!normalized) return null;
    return { ...normalized, ...seed };
}

/** Incident list row from GET /incidents (swagger example shape). */
export function normalizeIncident(raw: Json): D4HIncident | null {
    const id = num(raw.id);
    if (id === undefined) return null;

    const reference = str(raw.reference);
    const title =
        str(raw.referenceDescription) ??
        reference ??
        `Incident ${id}`;

    return {
        id,
        reference,
        title,
        startsAt:       str(raw.startsAt),
        endsAt:         str(raw.endsAt),
        trackingNumber: str(raw.trackingNumber),
        description:    str(raw.description),
        published:      typeof raw.published === 'boolean' ? raw.published : undefined,
    };
}
