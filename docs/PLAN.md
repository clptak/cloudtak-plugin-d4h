# cloudtak-plugin-d4h — Design & Implementation Plan

**Goal:** Pull personnel (and related resource) data from the D4H Team Manager v3 API into
CloudTAK, persist it so it survives reloads, and expose it as a roster that **other plugins
can consume** — e.g. a "select team member" picker when making an assignment.

This plan is grounded in the actual CloudTAK source (`~/CloudTAK`) and the three reference
plugins (`dispatcher`, `somewear`, `sar-management`). Where a claim depends on the live D4H
spec that could not be rendered here, it is marked **[verify]**.

---

## 1. Decisions locked in this session

| Question | Answer |
|----------|--------|
| Deliverable now | Plan first, then a reusable analysis `skill.md` |
| D4H API access | **Client-side direct** (browser → D4H with a user-entered token) |
| Data scope (v1) | **Members (personnel)**, **Qualifications/roles**, **Equipment/resources** |
| Persistence model | *Recommend* (see §4) |
| Cross-plugin consumption | *Recommend* (see §5) |
| Access control | **TAK channel/group-scoped** — visibility gated by the caller's TAK groups (see §4A) |

Duty/availability was deferred out of v1.

> **Access-control update (supersedes parts of §4/§5):** because you want visibility gated by
> authentication (TAK channel/group membership), the client-side layers **cannot** enforce it.
> The **Postgres server route becomes mandatory and authoritative**, and `db.kv` is demoted to a
> non-authoritative per-session cache of *already-authorized* results. See §4A.

---

## 2. How CloudTAK plugins actually work (verified against source)

These facts drive every recommendation below.

- **One bundle, one shared runtime.** `api/web/src/main.ts` loads every plugin with
  `import.meta.glob(['../plugins/*.ts', '../plugins/*/index.ts'])` and hands each one the
  **same** `PluginAPI` instance — which holds a **single shared `pinia`** and the **single
  shared Dexie database** (`src/database.ts`). Plugins are *not* standalone npm packages at
  runtime; they are compiled into CloudTAK's Vite build. (Confirmed by the Somewear
  `memory.md`: build with `cd ~/CloudTAK/api/web && npm run build`, not inside the plugin.)
- **The `PluginAPI` surface** (`api/web/plugin.ts`) gives plugins: `menu`, `routes`, `map`,
  `feature` (read local CoT features), `breadcrumb`, `float`, `bottomBar`, plus raw `app`,
  `router`, `pinia`. **There is no built-in per-plugin storage API** — persistence is
  something a plugin arranges itself.
- **Two persistence layers already exist in core and are shared by all plugins:**
  - `db.kv` — a generic `{ key: string, value: string }` IndexedDB table, with a ready-made
    helper class `src/base/kv.ts` (`KV.update(key, value)`, `KV.value(key)`,
    `KV.liveFrom(key)` → reactive Dexie `Observable`). **Per-device, zero server changes.**
  - `db.profile` + `ProfileConfig` (`src/base/profile.ts`) — a **per-user, server-synced**
    store that PATCHes `/api/profile`. **But its schema is locked**: the server route
    (`api/routes/profile.ts`) validates against a fixed TypeBox body (`display_*`, `tak_*`,
    `menu_order`, …). You **cannot** stash an arbitrary D4H roster here without patching core.
- **Server-side custom tables are possible** the way the dispatcher does it
  (`server/plugin-dispatcher.ts`): a route file copied into `api/routes/` runs
  `CREATE TABLE IF NOT EXISTS …` against CloudTAK's Postgres (`config.pg.execute(sql\`…\`)`)
  and exposes CRUD under `/api/…`, with `Auth` giving the authenticated user. This is
  **shared across all users/devices** on that CloudTAK and requires an API image rebuild to
  install.
- **Capacitor `Preferences`** (used by Somewear and the dispatcher store) is the right place
  for small per-device config like the D4H token and base URL — more reliable than
  `localStorage` in CloudTAK's PWA context.

### The persistence options, summarized

| Layer | Scope | Survives reload | Cross-device / cross-user | Server change? | Good for |
|-------|-------|-----------------|---------------------------|----------------|----------|
| `db.kv` (Dexie) | Per device/browser | Yes | No | **None** | The cached roster, v1 |
| `Preferences` | Per device/browser | Yes | No | None | Token, base URL, context id |
| `ProfileConfig` | Per user | Yes | Yes | **Schema-locked — not usable for arbitrary roster** | — |
| Custom Postgres route | All users | Yes | Yes | API rebuild | Durable shared roster, Phase 2 |

---

## 3. D4H Team Manager v3 API (client-side direct)

- **Host (regional):** `https://api.team-manager.us.d4h.com` (also `.eu`, `.ap`, `.ca`). The
  region must be configurable.
- **Auth:** `Authorization: Bearer <token>` using a D4H access token the user pastes in. **[verify]** exact token type/scope on your account.
- **Path shape:** `/v3/{context}/{contextId}/…` where `context` is e.g. `team` and
  `contextId` is the numeric id. The user supplies context + id in config.
- **Endpoints for v1 scope:**
  - Members: `GET /v3/{context}/{contextId}/members` (the linked endpoint).
  - Qualifications/roles: member qualification awards endpoint, e.g.
    `/v3/{context}/{contextId}/member-qualifications` or `…/qualification-awards`. **[verify]**
  - Equipment: `GET /v3/{context}/{contextId}/equipment`. **[verify]**
- **Pagination & envelope:** D4H v3 wraps results in `{ results: [...] }` — **confirmed**
  by the Phase 0 spike against `/v3/team/12345/members`. Pagination cursor field names still
  need confirming on a multi-page response (likely `page`, `size`, `totalSize` or a `next`
  cursor) — **[verify]** by paging beyond the first response.

### ⚠ Honest risk: CORS — **RESOLVED**

Phase 0 spike (2026-06-05) against `https://api.team-manager.us.d4h.com` returned:
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET,…`,
`Access-Control-Allow-Headers: authorization`. A real browser `GET` with a Bearer token
also succeeded (HTTP 200). **Client-side direct stands**; the server-proxy fallback is not
needed for connectivity reasons. Constraint to honor: do **not** set
`credentials: 'include'` on these calls (wildcard `Allow-Origin` is incompatible with
credentialed requests; Bearer auth doesn't need cookies).

---

## 4. Recommended persistence

**v1 — use `db.kv` (Dexie) for the cached roster, `Preferences` for credentials/config.**

Rationale: it matches the locked "client-side direct" decision, requires **zero changes to
CloudTAK core or the API image**, is already imported by every plugin, and is reactive
(`KV.liveFrom`) so consumers update live. "For that user" is satisfied in practice because a
CloudTAK browser session is one signed-in user; the roster lives in that user's device DB.

Keys (namespaced so other plugins can find them):

```
d4h:roster        → JSON: { fetchedAt, context, contextId, members[], equipment[] }
d4h:meta          → JSON: { lastSync, source, region }
```

Token/base URL/context go in `Preferences` (not `kv`), e.g. `d4h-config-v1`, so credentials
aren't sitting in the shared roster blob.

**Phase 2 (optional upgrade) — add a Postgres-backed per-user table** via a `server/` route
(dispatcher pattern) if you later need: roster shared across devices/users, server-side
caching so each browser doesn't re-hit D4H, or availability to server-side consumers. This is
a clean additive step behind the same client interface and does not invalidate v1.

`ProfileConfig` is explicitly **not** recommended for the roster — its schema is locked by the
server route.

> **Note (access control):** the above v1 recommendation assumes no authenticated visibility
> rules. Because you DO need TAK-group-scoped visibility, §4A overrides this: the Postgres route
> is mandatory and authoritative, and `db.kv` drops to a non-authoritative cache.

---

## 4A. Access control (TAK channel/group-scoped) — verified against source

You want roster visibility gated by **authentication**, specifically **TAK channel/group
membership** (the closest thing CloudTAK has to LDAP-group-driven access). Three facts from the
source determine the design:

1. **Only a server route can enforce this.** `db.kv` and `Preferences` live in the browser and
   have no access control — anything cached there is visible to that session. `ProfileConfig`
   is per-user *settings*, not an authorization mechanism. **So the Postgres route is mandatory,
   not optional, and is the source of truth for who-can-see-what.**
2. **CloudTAK does not authenticate via LDAP directly.** Identity is a JWT from the TAK /
   Authentik IdP. `api/routes/ldap.ts` is a *CoTAK-only proxy* (`config.user.get('cotak')`,
   gated on `cotak.configured`) for listing channels / creating machine users — not a generic
   login backend. **LDAP groups reach you indirectly:** LDAP → IdP → TAK Server group
   membership → your route reads those groups. If your TAK auth backend is LDAP-backed, TAK
   groups *are* effectively your LDAP groups.
3. **A route can resolve the caller's TAK groups today.** This is exactly what
   `api/routes/marti.ts` (`GET /api/marti/group`) does, and `marti-mission.ts` already filters
   visibility with `missionGroups.some(g => groupList.includes(g))`.

### Pattern to implement

```ts
// In the D4H server route (copy the marti.ts handle pattern):
const user    = await Auth.as_user(config, req);                 // validates JWT → identity
const profile = await config.models.Profile.from(user.email);
const api     = await TAKAPI.init(
  new URL(String(config.server.api)),
  new APIAuthCertificate(profile.auth.cert, profile.auth.key),   // caller's own TAK cert
);
const myGroups = (await api.Group.list({ useCache: true })).data // groups from the auth backend
                  .filter(g => g.active).map(g => g.name);

// Roster rows are tagged with the group(s) that may see them (Data.mission_groups pattern):
//   d4h_members(... , groups TEXT[] NOT NULL DEFAULT '{}')
// On read, return only rows whose group tags intersect the caller's groups:
const visible = rows.filter(r => r.groups.some(g => myGroups.includes(g)));
```

- **Table:** add a `groups TEXT[]` column to the `d4h_members` (and `d4h_equipment`) table,
  mirroring `Data.mission_groups`. How D4H members map to TAK groups is a business rule to
  define (e.g. D4H team/unit → TAK channel name) — **confirm the mapping** (see §8).
- **Admin tiers still apply:** you can additionally allow `profile.system_admin` /
  `agency_admin` to see all, and use `Auth.as_user(req, {admin:true})` to gate write/sync
  endpoints.
- **`useCache`:** `api.Group.list({ useCache:true })` returns the user's cached selection;
  `false` re-pulls from the auth backend. Pick deliberately — cached is cheaper, fresh is more
  authoritative right after a group change. **[verify]** behavior on your deployment.

### One dependency to confirm
The route needs a TAK API handle. `marti.ts` builds it from `profile.auth.cert/key`, so the
calling user must have a provisioned TAK cert on their profile (normal for CloudTAK users). If
a consumer context lacks that, fall back to a connection cert (`req.query.connection` branch in
`marti.ts`). **[verify]** that D4H plugin callers always have `profile.auth.cert`.

## 5. Recommended cross-plugin consumption

The constraint that matters: plugins live in separate repos and **cannot compile-time-import
each other's modules**, but they **do share one runtime** (one pinia, one Dexie `db`, and the
same core `src/base/*` singletons).

> **Revised by §4A.** With TAK-group access control, the **authorizing `/api/d4h/...` endpoint
> is the cross-plugin boundary** — it returns only the rows the *calling user's* groups may see.
> `db.kv` is no longer the sharing contract; it is at most a per-session cache of the
> already-filtered response. Do **not** let a consumer read an unfiltered roster blob from
> `db.kv`, or you leak rows past the group gate.

**Recommendation (access-controlled): consumers call the authorizing endpoint via a published
TypeScript client + types — not a raw `db.kv` blob, not a directly imported Pinia store.**

- The **D4H plugin is the sole owner** of D4H access and of the `d4h_members` / `d4h_equipment`
  tables, and exposes `GET /api/d4h/members` (group-filtered per §4A).
- **Any other plugin gets the roster by calling that endpoint** with the user's session (via
  CloudTAK's `std()` helper, which carries the session JWT), e.g.:

  ```ts
  import { std } from '../../src/std.ts';
  const members = await std('/api/d4h/members') as D4HMember[]; // already group-filtered
  ```

- Optionally cache the *response* in `db.kv` per session (`KV.liveFrom` for reactivity), but
  treat it as a view of authorized data, never the authority.
- Ship the shared **types** (`D4HRoster`, `D4HMember`, `D4HEquipment`) as a tiny committed
  `.d.ts`/types module consumers reference. The **endpoint shape + types are the public
  contract.**
- **Optional convenience:** publish a drop-in `<D4HMemberPicker>` Vue component that calls the
  endpoint, so consumers get a working assignment picker for free.

Why not a shared `db.kv` blob or Pinia store as the boundary? Neither can enforce the group
gate — both expose whatever is in memory to any plugin/user in that session. They're fine for
*caching authorized results*, not for *being the source of truth* once visibility rules exist.

Why not a shared Pinia store? It works at runtime (all plugins share `api.pinia`, and a
consumer could read `pinia.state.value['d4h']` by well-known id), but reading raw pinia state
by string id is more fragile and less discoverable than the already-blessed `KV` helper, and
it isn't persistent on its own. `KV` gives persistence + reactivity + a stable import path in
one. Use a local Pinia store *inside* the D4H plugin for its own UI state if helpful, but make
`db.kv` the cross-plugin boundary.

---

## 6. Phased build

**Phase 0 — CORS spike — ✅ DONE (2026-06-05).**
Confirmed client-side direct works: preflight returns `Allow-Origin: *` and a real
browser `GET /v3/team/12345/members` with a Bearer token returned HTTP 200 with a
`{ results: [...] }` envelope. Spike artifacts live at `spike/phase-0-cors/`.

**Phase 1 — Plugin scaffold.**
Mirror the Somewear/dispatcher layout: `plugin/index.ts` implementing `PluginInstance`
(`install` adds a `home-menu` route, `enable` adds the menu item, `disable` removes only the
menu item — see the dispatcher's note about not removing the route). `package.json` with the
`@tak-ps/cloudtak` file-dep and peer deps. Build via `cd ~/CloudTAK/api/web && npm run build`.

**Phase 2 — Config UI + credentials.**
Region, base URL, `context`, `contextId`, and token, persisted in `Preferences`. "Test
connection" button (reuses the Phase 0 call).

**Phase 3 — Fetch + normalize.**
A `d4h-client.ts` that pulls members, qualifications, and equipment (handling pagination) and
maps D4H fields → normalized `D4HMember` / `D4HEquipment` shapes. A "Sync now" button +
last-sync display.

**Phase 3.5 — Server route + tables (now core, not optional — required for access control).**
Add `server/plugin-d4h.ts` (dispatcher pattern): `CREATE TABLE IF NOT EXISTS d4h_members /
d4h_equipment` with a `groups TEXT[]` column, write/sync endpoints (admin-gated via
`Auth.as_user(req,{admin:true})`), and a group-filtered `GET /api/d4h/members` per §4A. The
sync writes each row tagged with the TAK group(s) allowed to see it (per the mapping in §8).
Installs by copying `server/` into `api/routes/` + API rebuild.

**Phase 4 — Roster UI.**
List/search of members (callsign/name, ref, roles/qualifications, status), and equipment —
reading the group-filtered endpoint.

**Phase 5 — Cross-plugin contract.**
Freeze and document the `/api/d4h/...` endpoint shape + types. Ship the optional
`<D4HMemberPicker>`. Wire one real consumer (the **dispatcher PersonnelListView** or
**sar-management** assignment flow) as the proof that selection-for-assignment works end to end
**and respects group visibility**.

**Phase 6 (optional) — per-session caching** of the authorized response in `db.kv` for snappier
re-opens, treated as a non-authoritative view.

---

## 7. Normalized data shapes (refined after Phase 0)

Phase 0 confirmed: `id` is numeric, contact details are nested objects, status is uppercase
enum (e.g. `"RETIRED"`), and `qualifications` is **not** present on the member object — it
comes from a separate endpoint and must be joined client-side by member id.

```ts
export interface D4HMember {
  id: number;            // D4H member id (numeric in source)
  ref?: string;          // D4H reference / badge number — LINKS to TAK callsign (see §7A):
                         //   member.ref === last 3 digits of the TAK callsign
  name: string;          // source format: "Last, First " — trim and consider splitting
  callsign?: string;     // map to CloudTAK callsign if available
  position?: string;     // role/position name (free-text in source)
  status?: string;       // uppercase enum: OPERATIONAL / NON_OPERATIONAL / RETIRED / … [verify]
  qualifications?: { id: number; name: string; expiresAt?: string }[]; // joined from a separate endpoint
  email?: string;        // normalized from source .email.value
  phone?: string;        // normalized from .mobile.phone || .work.phone || .home.phone
}

export interface D4HEquipment {
  id: number;
  ref?: string;
  name: string;
  category?: string;
  status?: string;
}

export interface D4HMember {
  // …fields above…
  groups?: string[];     // TAK group/channel names allowed to see this member (access control, §4A)
}

export interface D4HRoster {
  fetchedAt: string;     // ISO
  region: string;        // us | eu | ap | ca
  context: string;       // e.g. "team"
  contextId: number;     // numeric in source (e.g. 12345)
  members: D4HMember[];
  equipment: D4HEquipment[];
}
```

> `groups[]` is the access-control tag from §4A — the server filters rows so each caller only
> receives members whose `groups` intersect the caller's TAK groups.

---

## 7A. Identity linkage: D4H `ref` ↔ TAK callsign

**The link:** a D4H member's **`ref`** equals the **last 3 digits of that person's TAK
callsign**. This is the key that lets the plugin (and other plugins) **resolve D4H info from a
callsign** — e.g. click a contact on the map, take the last 3 digits of their callsign, and pull
that member's D4H roles/qualifications/equipment.

```ts
// callsign → D4H ref
function refFromCallsign(callsign: string): string | null {
  const m = callsign.match(/(\d{3})\D*$/);   // last run of 3 digits at end
  return m ? m[1] : null;
}

// lookup against the roster (compare normalized, since ref may be stored without padding)
function memberForCallsign(callsign: string, members: D4HMember[]): D4HMember | undefined {
  const ref = refFromCallsign(callsign);
  if (!ref) return undefined;
  const norm = (s?: string) => String(s ?? '').replace(/^0+/, '');  // tolerate leading zeros
  return members.find(p => norm(p.ref) === norm(ref));
}
```

**Both directions this enables:**
- **Callsign → D4H** (primary): given any TAK callsign (a map contact, or the logged-in user's
  `tak_callsign` from `ProfileConfig`), look up the member and surface their D4H record.
- **D4H → callsign**: the roster can show/sort by the expected callsign suffix, and assignment
  flows can match a selected D4H member back to the live TAK contact.

**Index for it:** when building the access-controlled roster, keep `ref` indexed (and exposed on
the `/api/d4h/members` response) so a `?callsign=` or `?ref=` lookup endpoint is cheap. Group
access control (§4A) still applies to the lookup result — a callsign lookup returns a member
only if the caller's TAK groups permit.

**Edge cases to confirm (§8):** whether `ref` is always exactly 3 digits (vs. zero-padded or
longer), whether callsigns reliably end in 3 digits, and how to handle collisions or a callsign
with no numeric suffix. `[verify]` the exact `ref` format against your D4H account.

---

## 8. Open items to confirm (one at a time, per project rules)

1. ~~D4H **region**~~ — **us** (confirmed Phase 0).
2. ~~**context** type + **contextId**~~ — `team` / **12345** (confirmed Phase 0 via `owner.id`).
3. Exact **qualifications** and **equipment** endpoint paths — members response carries no
   `qualifications` field, so the member-qualifications/awards endpoint is required for
   Phase 3. The members envelope is `{ results: [...] }` (confirmed); equipment envelope
   still **[verify]** with one authenticated GET.
4. Whether v1 should also carry a CloudTAK **callsign mapping** (D4H field → `tak_callsign`)
   so assignments can message the right contact.
5. **Access-control mapping (§4A) — DECIDED: derive from a D4H field.** The `groups[]` column is
   populated from a D4H member attribute, mapped to TAK channel name(s). Most likely source is
   the member's **D4H Group membership** (D4H Team Manager organizes members into Groups within
   a team) — or a member custom field if you prefer. **[verify]** the exact field name + whether
   a member can be in multiple groups (→ `groups[]` is an array) against your live spec, and
   confirm the D4H-group-name → TAK-channel-name correspondence (identical names, or a small
   lookup the plugin holds).
6. `api.Group.list` **`useCache`** preference (cached selection vs. fresh from auth backend),
   and confirmation that D4H plugin callers always have a `profile.auth.cert` for the TAK API
   handle.
7. **`ref` ↔ callsign format (§7A):** is `ref` always exactly 3 digits (or zero-padded /
   variable length)? Do TAK callsigns here reliably end in those 3 digits? How should the plugin
   handle a callsign with no 3-digit suffix, or two members sharing a `ref`?
