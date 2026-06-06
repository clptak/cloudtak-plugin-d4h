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

import type { D4HMember, D4HEquipment, D4HQualification, D4HStatus } from './d4h-types.ts';

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
    const id = num(raw.id);
    const name = str(raw.name);
    if (id === undefined || !name) return null;
    return {
        id,
        ref:      str(raw.ref),
        name,
        category: str((raw.category as Json | undefined)?.title) ?? str(raw.category),
        status:   str(raw.status),
    };
}

export function normalizeQualification(raw: Json): D4HQualification | null {
    // D4H qualification-award shapes vary by endpoint; cover the common ones.
    // - { id, qualification: { id, name }, expiresAt, memberId }
    // - { id, name, expiresAt, member: { id } }
    const id = num(raw.id);
    if (id === undefined) return null;

    const qualName =
        str(raw.name) ??
        nestedString(raw.qualification, 'name') ??
        nestedString(raw.qualification, 'title');
    if (!qualName) return null;

    const expiresAt = str(raw.expiresAt) ?? str(raw.expires_at) ?? str(raw.expiry);

    const memberId =
        num(raw.memberId) ??
        num((raw.member as Json | undefined)?.id);

    return { id, name: qualName, expiresAt, memberId };
}
