// Normalized D4H shapes used inside the plugin and (Phase 5) published as the
// cross-plugin contract for /api/d4h/members.
//
// Field choices reflect plan §7 as refined by the Phase 0 spike:
//   - id is numeric in source
//   - email/phone are flattened to a single string from nested source objects
//   - status is the uppercase D4H enum (OPERATIONAL / NON_OPERATIONAL / RETIRED / …)
//   - qualifications come from a separate endpoint and are joined client-side by member id
//   - groups[] is the access-control tag (plan §4A) — populated by the Phase 3.5 server
//     route, not the client. Left optional on the client-side type so client cache can omit it.

export type D4HStatus =
    | 'OPERATIONAL'
    | 'NON_OPERATIONAL'
    | 'RETIRED'
    | 'OBSERVER'           // [verify]
    | 'PROBATIONARY'       // [verify]
    | (string & {});       // accept unknown enums without losing type safety

export interface D4HQualification {
    id:         number;
    name:       string;
    expiresAt?: string;    // ISO; absent if non-expiring
    memberId?:  number;    // present when joined by membership
}

export interface D4HMember {
    id:             number;
    ref?:           string;           // links to TAK callsign suffix — see plan §7A
    name:           string;           // trimmed; D4H source format is "Last, First "
    callsign?:      string;
    position?:      string;
    status?:        D4HStatus;
    email?:         string;           // flattened from .email.value
    mobile?:        string;           // .mobile.phone specifically (no fallback) — shown in roster
    phone?:         string;           // .mobile.phone || .work.phone || .home.phone
    qualifications?: D4HQualification[];
    groups?:        string[];         // server-set (plan §4A); client cache may omit
}

export interface D4HEquipment {
    id:         number;
    ref?:       string;
    name:       string;
    categoryId?: number;             // D4H EquipmentCategory id (records reference category by id only)
    category?:  string;              // resolved category title (looked up from the category list)
    status?:    string;
    groups?:   string[];              // server-set (plan §4A); client cache may omit
}

export interface D4HRosterMeta {
    fetchedAt:    string;             // ISO
    region:       string;
    context:      string;             // "team" | "organization"
    contextId:    number;
    memberCount:  number;
    equipmentCount: number;          // count AFTER the category filter (wanted categories only)
    /** Every distinct equipment category D4H returned, with counts and whether the filter kept it. */
    equipmentCategories?: { title: string; count: number; included: boolean }[];
    /** Warnings collected during sync — e.g. "equipment endpoint returned 404". */
    warnings:     string[];
}

export interface D4HRoster {
    meta:      D4HRosterMeta;
    members:   D4HMember[];
    equipment: D4HEquipment[];
}
