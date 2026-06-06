---
name: cloudtak-infra-analysis
description: >-
  Analyze CloudTAK's infrastructure to decide HOW a plugin should get external data into
  CloudTAK, persist it, and share it with other plugins. Use this whenever planning a new
  CloudTAK plugin or extending one — e.g. "can plugin X read data from plugin Y", "where
  should this roster/config/cache live", "should this call go client-side or through a server
  route", "how do plugins share data in CloudTAK", or before scaffolding any plugin that pulls
  from an external API (D4H, CAD, webhooks, etc.). It produces a grounded feasibility +
  architecture recommendation, not code.
---

# CloudTAK infrastructure analysis

Purpose: before building or extending a CloudTAK plugin, determine — **from the actual source,
not assumptions** — how data should enter CloudTAK, where it should persist, and how it can be
shared across plugins. Output is a short, source-cited recommendation the user can act on.

This skill encodes patterns learned from the reference plugins (`dispatcher`, `somewear`,
`sar-management`) and CloudTAK core. Apply it to any plugin when directed.

## Operating rules (project)

- The user works in **one writable repo at a time** (e.g. `~/dev/cloudtak-plugin-*`). All
  other folders — including `~/CloudTAK` and sibling plugin repos — are **read-only reference**.
  Never edit them.
- **Ask the user one question at a time. Do not assume** region, IDs, scope, or persistence
  intent — confirm them.
- Prefer **CloudTAK native APIs over Node-RED**; Node-RED only when CloudTAK genuinely can't.

## Workflow

### 1. Frame the goal as three sub-questions
For the data the plugin handles, separate:
- **Acquisition** — where does the data come from (external API? webhook/SSE? TAK Server? CoT
  features already on the map?), and does the call go **client-side direct** or through a
  **server route**?
- **Persistence** — does it need to survive reload? per-device, per-user, or all users?
- **Sharing** — does another plugin need to read it, and how decoupled must that be?

### 2. Verify the plugin runtime model (don't trust memory — grep it)
Confirm these in the local `~/CloudTAK` checkout before recommending anything:
- Plugin loader: `api/web/src/main.ts` — how plugins are discovered (currently
  `import.meta.glob(['../plugins/*.ts','../plugins/*/index.ts'])`) and that they share **one
  `PluginAPI`** → **one `pinia`** + **one Dexie `db`**.
- Plugin surface: `api/web/plugin.ts` — `PluginInstance` (`install/enable/disable`) and
  `PluginAPI` (`menu`, `routes`, `map`, `feature`, `breadcrumb`, `float`, `bottomBar`,
  `app/router/pinia`). Note what is **not** there (no built-in storage API).
- Build/deploy reality: web plugins are bundled by Vite from `api/web`
  (`cd ~/CloudTAK/api/web && npm run build`), **not** built inside the plugin folder.

### 3. Map the data goal onto CloudTAK's real persistence layers
Check `api/web/src/database.ts` and `api/web/src/base/*` for what already exists, then pick:

| Layer | Where | Scope | Server change? | Use it for |
|-------|-------|-------|----------------|------------|
| `db.kv` via `src/base/kv.ts` (`KV.update/value/liveFrom`) | IndexedDB | Per device | None | Cached datasets shared across plugins, reactively |
| Capacitor `Preferences` | Device | Per device | None | Small config, tokens, last-selected ids |
| `ProfileConfig` / `db.profile` (`src/base/profile.ts`) | Server `/api/profile` | Per user | **Schema-locked** in `api/routes/profile.ts` — only usable for existing typed keys | Built-in user settings, NOT arbitrary plugin data |
| Custom Postgres table via a `server/` route | CloudTAK Postgres | All users | API image rebuild | Durable, shared-across-users/devices/server data |

Verify the `db.kv`/`profile` claims each time — the Dexie schema and the profile TypeBox body
can change between CloudTAK versions.

### 4. Decide acquisition (client vs server) and flag CORS honestly
- **Client-side direct** is simplest but: (a) the token lives in the browser, and (b) the
  external host must send CORS headers for the CloudTAK origin. **Always recommend a CORS
  spike before committing.**
- **Server route** (pattern: dispatcher `server/plugin-takcad.ts` proxy and
  `server/plugin-dispatcher.ts` store) hides the token and enables server-side caching, at the
  cost of an API rebuild to install. Keep the client interface identical so client↔server is a
  one-file swap if CORS forces it.

### 5. Decide cross-plugin sharing
Plugins are separate repos → **no compile-time cross-imports**, but they share one runtime.
Default recommendation:
- The owning plugin writes a normalized blob to a **namespaced `db.kv` key** (e.g.
  `myplugin:roster`).
- Consumers read it via the core `KV` helper they already have
  (`KV.value('myplugin:roster')`, reactive `KV.liveFrom(...)`) — **no dependency on the owner
  plugin**.
- Publish the **TypeScript contract** (the key names + a `.d.ts` of the blob shape) as the
  public API. Optionally ship a drop-in Vue picker component as sugar.
- For all-users/server sharing, upgrade the persistence to a Postgres route behind the same
  contract.
- Reading another plugin's Pinia store by id (`pinia.state.value['id']`) is possible but more
  fragile and not persistent — prefer `db.kv`.

### 5A. If the goal needs access control based on authentication
Client layers (`db.kv`, `Preferences`) and `ProfileConfig` **cannot enforce visibility** — only
a **server route** can, because it validates the caller. Verify and use:
- `lib/auth.ts` — `Auth.as_user` / `Auth.as_profile` validate the JWT and yield identity
  (`email`), tier (`AuthUserAccess` USER/AGENCY/ADMIN, `is_admin()`), and agency
  (`profile.system_admin`, `agency_admin[]`, `agency`).
- **TAK channel/group scoping** (closest to LDAP-group access): a route resolves the caller's
  groups exactly like `routes/marti.ts` does — build a TAK handle from `profile.auth.cert/key`
  via `TAKAPI.init(...)`, call `api.Group.list({ useCache })`, then filter rows whose group
  tags intersect (pattern: `marti-mission.ts` `missionGroups.some(g => groupList.includes(g))`).
  Tag stored rows with a `groups TEXT[]` column (mirror `Data.mission_groups`).
- **LDAP is not a CloudTAK login backend.** `routes/ldap.ts` is a CoTAK-only proxy. LDAP groups
  arrive indirectly: LDAP → IdP → TAK Server groups → your route. State this honestly.
- When access control exists, the **cross-plugin boundary becomes the authorizing endpoint**
  (`std('/api/<plugin>/...')`), not a raw `db.kv` blob — caching the filtered response in
  `db.kv` is fine, but it must never be the authority.

### 6. Produce the recommendation
Deliver a short doc (see `docs/PLAN.md` in this repo for the worked example) containing:
locked decisions, a CloudTAK-facts section **with file paths cited**, the persistence and
sharing recommendation with rationale, the CORS risk + fallback, a phased build (spike first),
normalized data shapes, and a one-at-a-time list of open items to confirm with the user.

## Reference patterns (read these when relevant)
- `~/dev/cloudtak-dispatcher-plugin/server/plugin-dispatcher.ts` — custom Postgres table +
  `/api/...` CRUD via `config.pg.execute(sql\`CREATE TABLE IF NOT EXISTS ...\`)`.
- `~/dev/cloudtak-dispatcher-plugin/server/plugin-takcad.ts` — server-side proxy to an
  external/TAK-Server plugin (the CORS-safe acquisition fallback).
- `~/dev/cloudtak-dispatcher-plugin/plugin/lib/contacts-client.ts` — using CloudTAK's own
  `/api/marti/...`, `Chatroom`, and `ProfileConfig` from a plugin.
- `~/dev/cloudtak-pluin-somewear/memory.md` — hard-won build/deploy + auth/token lessons
  (Vite build location, Subscription token handling, mission writes via
  `subscription.log.create`).
- `~/dev/cloudtak-pluin-somewear/index.ts` and `~/dev/cloudtak-dispatcher-plugin/plugin/index.ts`
  — the `install/enable/disable` lifecycle, including the dispatcher note: in `disable()`
  remove only the menu item, never the route.

## Anti-patterns
- Recommending architecture from memory without grepping the current `~/CloudTAK` source.
- Using `ProfileConfig` for arbitrary plugin data (schema is server-validated).
- Building UI before the CORS spike on a client-side-direct external call.
- Coupling consumer plugins to the owner plugin's modules instead of the `db.kv` contract.
- Trying to enforce authenticated visibility in a client layer (`db.kv`/`Preferences`/
  `ProfileConfig`) — only a server route can. When visibility rules exist, share via the
  authorizing endpoint, not a raw `db.kv` blob.
- Claiming CloudTAK does LDAP login — it doesn't; groups arrive via the TAK/Authentik IdP.
- Editing any read-only reference repo.
