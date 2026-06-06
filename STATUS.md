# cloudtak-plugin-d4h — Status

_Last updated: 2026-06-06. Grounded in the current code, not just the plan._

This is a point-in-time status of where the plugin's data lives, what it contains, and
how other CloudTAK plugins can consume it. For the full design rationale and the planned
(not-yet-built) server/access-control work, see `docs/PLAN.md`.

## Where the data resides

Two separate stores, both **browser-local only** — there is no server-side persistence built yet.

**Credentials + config** live in Capacitor `Preferences` under a single key `d4h-config-v1`
(`lib/d4h-config.ts`): region, optional base-URL override, context (`team` / `organization`),
contextId, and the bearer token. On native this maps to iOS Keychain /
Android EncryptedSharedPreferences; on web/PWA it falls back to unencrypted localStorage.
Per-device, and deliberately kept out of the shared roster blob so the token isn't sitting
in cross-plugin storage.

**The roster** lives in CloudTAK's shared Dexie / IndexedDB `db.kv` table (`lib/d4h-roster.ts`),
under two keys:

- `d4h:roster` — the full `D4HRoster` JSON
- `d4h:meta` — a lightweight header (`D4HRosterMeta`) for cheap "last sync" reads

It survives reloads and is reactive (`liveQuery` / `KV.liveFrom`), but is **per-device /
per-browser** — not synced across devices or users, and not access-controlled.

## What data is there

`D4HRoster = { meta, members[], equipment[] }` (`lib/d4h-types.ts`):

- **Members** (now operational-only): `id`, `ref` (the D4H reference that equals the last
  3 digits of the TAK callsign), `name`, `position`, `status`, `email`, `mobile`, `phone`,
  optional `qualifications[]`, and a reserved `groups[]` field that is currently unpopulated.
- **Equipment** (filtered to vehicles / UAS / tech litter): `id`, `ref`, `name`, `categoryId`,
  `category`, `status`. D4H equipment records carry no top-level name — `name` is taken from
  the equipment **kind** title (e.g. "NIGHT VISION MONOCULAR"). The record references its
  category by **id only**, so `category` (the title) is resolved from the separate
  EquipmentCategory list during sync.
- **Qualifications**: joined onto members by `memberId` — **working** (last sync resolved 56).
- **meta**: `fetchedAt`, `region`, `context`, `contextId`, `memberCount`, `equipmentCount`
  (post-filter), `equipmentCategories[]` (every category title found, with counts and whether
  the filter kept it), and a `warnings[]` array.

## How other plugins access it

**Today (the only working path):** every CloudTAK plugin shares one runtime — the same Pinia
and the same Dexie `db`. So another plugin in the same session can read the roster directly
from `db.kv`:

```ts
import KV from '../../src/base/kv.ts';
const roster = JSON.parse(await KV.value('d4h:roster')); // D4HRoster
// or reactive: KV.liveFrom('d4h:roster')
```

It imports the shape from `lib/d4h-types.ts`. **Caveat:** this path is unauthenticated and
unfiltered — whatever is cached is visible to any plugin in that session.

**Intended but not yet built (`docs/PLAN.md` §4A / §5, Phase 3.5):** a Postgres-backed
`GET /api/d4h/members`, filtered by the caller's TAK group membership, becomes the
authoritative cross-plugin boundary, with `db.kv` demoted to a non-authoritative cache.
Consumers would call `std('/api/d4h/members')`. The `groups[]` field on members is the
reserved hook for that filtering — which is why it exists but is empty today.

## Net status

| Area | State |
|------|-------|
| Members | Working. Operational-only filter and the pagination off-by-one both fixed. |
| Equipment | Working. Filtered to vehicles / UAS / tech litter, with a sortable table in the view. Names come from the equipment kind title; category names are resolved from the EquipmentCategory list. Categories are discovered and reported each sync. |
| Qualifications | Working. Joined onto members by `memberId` (last sync resolved 56). |
| Cross-plugin sharing | Raw `db.kv` cache only; no access control yet. |
| Server route / TAK-group access control | Not built (planned Phase 3.5). |

## Recent fixes

- **Pagination off-by-one:** D4H list endpoints are 0-indexed; the loop started at `page=1`
  and silently dropped the first page (the "short by exactly one page" symptom on both
  members 444/544 and equipment 285/385). Now starts at `page=0` with a 1-indexed fallback.
- **Operational-only:** members are fetched with a server-side `?status=OPERATIONAL` filter,
  with a safe fallback to fetch-all + client-side filtering if D4H rejects the param.
- **Roster UI:** the Status column was replaced with a Mobile column (`.mobile.phone`), and
  the status filter buttons were removed since the data is now operational-only.
- **Equipment (Phase 4):** a second table shows equipment limited to vehicles / UAS /
  tech litter. Categories are matched tolerantly (case-insensitive substring) against
  D4H's team-defined category titles, configured in one place
  (`lib/d4h-equipment-categories.ts`, `WANTED_CATEGORY_KEYWORDS`). Each sync discovers and
  reports every distinct category title D4H returned (`meta.equipmentCategories`), and warns
  if a wanted keyword matched nothing. Filtering is currently client-side and authoritative;
  a server-side `?category=` request filter can be layered on once the discovered category
  ids/labels are confirmed.
- **Equipment schema (verified against the live API):** D4H equipment records have no
  top-level `name` (the earlier normalizer silently dropped all 385 records for this reason)
  and reference their category by **id only** (`category: { id }`, no title). Fixed by:
  taking the display name from `kind.title`, fetching the EquipmentCategory list
  (`fetchEquipmentCategories`, with fallback path candidates) to build an id→title map, and
  resolving each item's `categoryId` to its title before filtering. Confirmed live: VEHICLES
  (1271), UAS (9046), Tech Litter (2966) all match the keyword filter without colliding with
  the other "Tech …" categories.
- **Qualifications:** now resolving (56 in the last sync) via the member-qualifications
  endpoint, joined onto members by `memberId`.
