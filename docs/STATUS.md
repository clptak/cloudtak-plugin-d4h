# cloudtak-plugin-d4h — Status

_Last updated: 2026-07-31. Grounded in the current code, not just the plan._

Point-in-time status of where the plugin's data lives, what D4H returns on sync, what gets
stored, and how other CloudTAK plugins can consume it. For design rationale see `docs/PLAN.md`.

---

## Architecture

**Hybrid mode (preferred):** when `server/plugin-d4h.ts` is installed into CloudTAK
`api/stateless/routes/`, a system admin stores the D4H token in Postgres (`d4h_config`).
The API pulls D4H on a schedule (and on admin `POST /api/d4h/sync`), writes normalized rows
tagged with `default_groups`, and serves group-filtered reads. The browser caches the
**already-authorized** response in `db.kv` for instant remounts.

**Fallback:** if the server route is missing or has no token, Sync now still runs
client-direct from Preferences (same as before).

```
D4H API ──(admin / periodic)──► CloudTAK API (plugin-d4h.ts)
                                      │
                                      ▼
                               Postgres d4h_* tables   ← authoritative + groups[]
                                      │
                         GET /api/d4h/roster|members|…
                                      │
                                      ▼
                               Browser db.kv cache     ← non-authoritative view
```

Install: `./scripts/install.sh [/path/to/CloudTAK]` then rebuild the API image.

Base path: `https://api.team-manager.{region}.d4h.com/v3/{context}/{contextId}/…`
Pagination: `?page=0&size=100` (0-indexed), deduped by record `id`.

---

## D4H API calls (each sync)

| # | Endpoint | What D4H returns (typical) | How the plugin uses it | Persisted? |
|---|----------|----------------------------|-------------------------|------------|
| 1 | **`/members`** (+ optional `?status=OPERATIONAL`) | `{ results: [...] }` — `id`, `ref`, `name`, `position`, `status`, nested `email`, `mobile`, etc. | Normalized to `D4HMember`. **Kept only if `status === OPERATIONAL`**. | Yes → Postgres `d4h_members` (+ `db.kv` cache) |
| 2 | **`/equipment`** | Rows with kind/model/brand/category refs | Normalized + filtered (operational + category keywords) | Yes → `d4h_equipment` |
| 3–5 | equipment-categories / brands / models | Lookup tables | Resolve titles onto equipment | Not stored separately |
| 6–7 | member-qualifications + awards | Catalog + member links | Joined onto `members[].qualifications[]` | Yes (on members) |

Endpoints 3–7 are **best-effort** (404 → warning, sync continues). Raw D4H JSON is never cached.

---

## Filters applied before storage

| Dataset | Filter |
|---------|--------|
| **Personnel** | `status === OPERATIONAL` only |
| **Equipment — status** | `OPERATIONAL` or `OPERATIONAL*` prefix |
| **Equipment — category** | Title contains `vehicle`, `uas`, or `tech litter` |

---

## Where data is stored

### 1. Capacitor `Preferences` — local credentials (fallback + writes)

| Key | Contents |
|-----|----------|
| `d4h-config-v1` | `{ region, baseUrl?, context, contextId, token }` |

Still required for Submit Incident / Roster / Subject. Optional for roster read when server sync is configured.

### 2. Postgres (hybrid) — authoritative shared roster

| Table | Role |
|-------|------|
| `d4h_config` | Server token, interval, `default_groups` |
| `d4h_members` / `d4h_equipment` / `d4h_external_resources` / `d4h_incidents` | Normalized rows + `groups TEXT[]` |
| `d4h_meta` | Last-sync header / warnings JSON |

### 3. CloudTAK Dexie `db.kv` — non-authoritative authorized cache

| Key | Contents |
|-----|----------|
| `d4h:roster` / `d4h:meta` | Filtered view for this caller |

Never holds the D4H token. Prefer `GET /api/d4h/members` via `std()` for cross-plugin sharing.

---

## Server API

| Method | Path | Auth | Role |
|--------|------|------|------|
| `GET` | `/api/d4h/config` | auth | Redacted config |
| `PUT` | `/api/d4h/config` | system admin | Save token / interval / default groups |
| `POST` | `/api/d4h/sync` | system admin | Pull D4H → Postgres |
| `GET` | `/api/d4h/roster` | auth | Group-filtered full roster |
| `GET` | `/api/d4h/members` | auth | Group-filtered members (`?ref=` / `?callsign=`) |
| `GET` | `/api/d4h/equipment` | auth | Group-filtered equipment |
| `GET` | `/api/d4h/meta` | auth | Last sync header |

Visibility: row `groups` ∩ caller's active TAK groups. System/agency admins see all.
v1 tagging: every row gets `d4h_config.default_groups`.

---

## How other plugins should consume it

```ts
import { std } from '../../src/std.ts';
const { members } = await std('/api/d4h/members') as { members: D4HMember[] };
```

---

## Net status

| Area | State |
|------|-------|
| Members / equipment / quals / resources / incidents | Working (client + server sync) |
| Hybrid Postgres + periodic sync | Built (`server/plugin-d4h.ts`, `server/d4h-sync.ts`) |
| TAK-group access control | Built via `default_groups` + caller group intersect |
| Cross-plugin sharing | Prefer `/api/d4h/members`; `db.kv` is a view cache |
| Per-member D4H→TAK group mapping | Deferred |
| Client-direct fallback | Still available when server route/token absent |
