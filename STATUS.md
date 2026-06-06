# cloudtak-plugin-d4h — Status

_Last updated: 2026-06-06. Grounded in the current code, not just the plan._

Point-in-time status of where the plugin's data lives, what D4H returns on sync, what gets
stored, and how other CloudTAK plugins can consume it. For design rationale and planned
(not-yet-built) server/access-control work, see `docs/PLAN.md`.

---

## Architecture

All D4H calls run **client-side** from the browser (Bearer token in config). Nothing goes
through the CloudTAK server today. On **Sync now**, the plugin calls D4H, normalizes results,
applies filters, and writes two blobs into CloudTAK's shared IndexedDB.

```
D4H API                          Browser / CloudTAK plugin
────────                         ─────────────────────────
members                    ──►   normalize + filter ──► db.kv  d4h:roster
equipment                  ──►                          ──► db.kv  d4h:meta
equipment-categories       ──►   (lookup only)
equipment-brands           ──►   (lookup only)
equipment-models           ──►   (lookup only)
member-qualifications      ──►

Preferences  d4h-config-v1  ◄──  token + context (never in db.kv)
```

Base path: `https://api.team-manager.{region}.d4h.com/v3/{context}/{contextId}/…`  
Pagination: `?page=0&size=100` (0-indexed), deduped by record `id`.

---

## D4H API calls (each sync)

| # | Endpoint | What D4H returns (typical) | How the plugin uses it | Persisted? |
|---|----------|----------------------------|-------------------------|------------|
| 1 | **`/members`** (+ optional `?status=OPERATIONAL`) | `{ results: [...] }` — `id`, `ref`, `name`, `position`, `status`, nested `email`, `mobile`, `work`, `home`, etc. | Normalized to `D4HMember`. **Kept only if `status === OPERATIONAL`** (client-side is authoritative). | Yes → `d4h:roster.members[]` |
| 2 | **`/equipment`** | Rows with `id`, `ref`, `status`, `kind` (`title`, `type` e.g. VEHICLE), `model` (`title` + often id-only `brand`), top-level `brand` (full or id-only), `category` (usually `{ id }` only). | Normalized to `D4HEquipment`. Lookup tables fill category / make / model. Then filtered (see below). | Yes → `d4h:roster.equipment[]` (filtered subset only) |
| 3 | **`/equipment-categories`** | `{ results: [{ id, title, … }] }` | id → title map; resolves **Category** on each item. | Not stored separately — only resolved `category` string |
| 4 | **`/equipment-brands`** | `{ results: [{ id, title, … }] }` | id → title map; fills **Make** when inline brand has no title. | Not stored separately — only resolved `make` |
| 5 | **`/equipment-models`** | `{ results: [{ id, title, brand: { id }, … }] }` | Fills **Model** when missing; can supply brand id for **Make**. | Not stored separately — only resolved `model` / `make` |
| 6 | **`/member-qualifications`** (fallback: `/qualification-awards`) | Qualification awards with `memberId`, name, expiry, etc. | Joined onto members by `memberId`. | Yes → `members[].qualifications[]` |

Endpoints 3–6 are **best-effort** (404 → warning, sync continues). Raw D4H JSON is never
cached — only the normalized roster.

---

## Filters applied before storage

| Dataset | Filter | Where |
|---------|--------|--------|
| **Personnel** | `status === OPERATIONAL` only | `lib/d4h-roster.ts` |
| **Equipment — status** | `OPERATIONAL` or any status starting with `OPERATIONAL` | `lib/d4h-status.ts` |
| **Equipment — category** | Category title contains `vehicle`, `uas`, or `tech litter` (case-insensitive) | `lib/d4h-equipment-categories.ts` |

Discovery stats for **all operational** equipment categories (including excluded ones) are
stored in `meta.equipmentCategories[]` for UI badges and sync warnings.

---

## Where data is stored in CloudTAK

Two separate stores, both **browser-local only** — no server-side persistence built yet.

### 1. Capacitor `Preferences` — credentials only

| Key | Contents | Scope |
|-----|----------|--------|
| `d4h-config-v1` | `{ region, baseUrl?, context, contextId, token }` | Per device/browser |

Native: Keychain / EncryptedSharedPreferences. Web/PWA: localStorage (not encrypted).  
Deliberately kept out of `db.kv` so the token is not in cross-plugin roster storage.

### 2. CloudTAK Dexie `db.kv` — shared roster cache

| Key | Contents | Scope |
|-----|----------|--------|
| `d4h:roster` | Full `D4HRoster` JSON | Per device/browser; visible to any plugin in the same session |
| `d4h:meta` | Lightweight `D4HRosterMeta` (header only, no arrays) | Same; used for "last sync" and reactive updates via `liveQuery` |

Written via `KV.update()` in `lib/d4h-roster.ts`. Survives reload; **not** synced across
devices or users; **not** access-controlled.

---

## Normalized shapes in `d4h:roster`

`D4HRoster = { meta, members[], equipment[] }` (`lib/d4h-types.ts`).

### `meta`

- `fetchedAt`, `region`, `context`, `contextId`
- `memberCount`, `equipmentCount` (post-filter counts)
- `equipmentCategories[]` — `{ title, count, included }` per category seen on operational equipment
- `warnings[]` — pagination gaps, dropped records, failed lookups, category keyword mismatches, etc.

### `members[]` (Personnel tab / cross-plugin lookup)

| Field | Source |
|-------|--------|
| `id` | D4H member id |
| `ref` | D4H ref (links to TAK callsign suffix — plan §7A) |
| `name`, `position`, `status` | Top-level member fields |
| `email` | `email.value` |
| `mobile` | `mobile.phone` (shown in UI) |
| `phone` | mobile → work → home fallback |
| `qualifications[]` | Joined from qualifications endpoint |
| `groups[]` | Reserved for future server-side access control — **empty today** |

### `equipment[]` (Equipment tab — filtered subset)

| Field | UI column | Source |
|-------|-----------|--------|
| `id` | (internal key only) | D4H equipment id |
| `ref` | **ID** | D4H ref / badge number |
| `name` | **Type** | `kind.title` (equipment kind) |
| `make` | **Make** | Inline `brand.title`, else `/equipment-brands` lookup via `brandId` or model's brand |
| `model` | **Model** | `model.title`, else `/equipment-models` lookup |
| `category` | **Category** | `/equipment-categories` lookup from category id |
| `brandId`, `modelId`, `categoryId`, `status` | Not shown | Used for resolution / filtering |

D4H equipment list rows often embed `category`, `model.brand`, etc. as **id-only references**
(no title). The plugin resolves titles from the separate catalog endpoints during sync — same
pattern as categories.

---

## What is **not** stored

- D4H bearer token (Preferences only)
- Raw API responses
- Separate copies of category / brand / model catalogs
- Non-operational members or equipment
- Equipment outside wanted categories (vehicles / UAS / tech litter)
- Server-side Postgres rows (planned Phase 3.5, not built)
- CloudTAK `ProfileConfig` / user profile

---

## UI (current)

- **Personnel tab** — operational members only; columns Badge, Name, Position, Mobile; sort/filter.
- **Equipment tab** — operational equipment in wanted categories; columns ID, Type, Make, Model, Category; sort/filter; category discovery badges.
- **Sync status / warnings** — dismissible alerts.
- **Plugin icon** — `lib/assets/d4h_personnel_logo.svg` via `lib/D4HIcon.vue`.

---

## How other plugins access it today

Every CloudTAK plugin shares one runtime — the same Pinia and Dexie `db`:

```ts
import KV from '../../src/base/kv.ts';
const roster = JSON.parse(await KV.value('d4h:roster')); // D4HRoster
// or reactive: KV.liveFrom('d4h:roster')
```

Import shapes from `lib/d4h-types.ts`.  
**Caveat:** unauthenticated, unfiltered cache — whatever was synced on that device is readable.

**Planned but not built** (`docs/PLAN.md` §4A / §5, Phase 3.5): Postgres-backed
`GET /api/d4h/members`, filtered by caller TAK groups; `db.kv` demoted to non-authoritative
cache; `groups[]` populated server-side.

---

## Net status

| Area | State |
|------|-------|
| Members | Working. Operational-only. Pagination 0-indexed. |
| Equipment | Working. Operational-only + category filter (vehicles / UAS / tech litter). Make/Model via brands/models lookups. |
| Qualifications | Working. Joined onto members by `memberId`. |
| Cross-plugin sharing | Raw `db.kv` cache only; no access control yet. |
| Server route / TAK-group access control | Not built (planned Phase 3.5). |

---

## Notable fixes & schema notes

- **Pagination off-by-one:** D4H list endpoints are 0-indexed; loop starts at `page=0` with 1-indexed fallback.
- **Operational personnel:** server-side `?status=OPERATIONAL` with client-side fallback.
- **Operational equipment:** status must be `OPERATIONAL` or `OPERATIONAL*`.
- **Equipment has no top-level name:** `name` (Type) comes from `kind.title`.
- **Category id-only:** resolved via `/equipment-categories`.
- **Brand id-only on list rows:** Make resolved via `/equipment-brands` (and optionally via model → brandId).
- **Model title:** from inline `model.title` or `/equipment-models` lookup.
- **Category discovery:** every operational category title reported in `meta.equipmentCategories`; warns if wanted keywords match nothing.
