# Plan: Submit Incident — DataSync mission → D4H incident

_Written 2026-06-06. Feature plan for a new "Submit Incident" tab in cloudtak-plugin-d4h.
Grounded in `docs/d4h_swagger.json`, the current code, and `docs/HANDOFF-incident-entry.md`.
This is the first **write** capability in the plugin — everything today is read-only._

---

## Goal

A new tab that reads the active DataSync mission, lets the user assemble an incident from its
CoT points, and `POST`s it to D4H:

```
POST https://api.team-manager.us.d4h.com/v3/team/<contextId>/incidents
```

(Context = `team`, contextId = `<contextId>`, from `d4h-config-v1`.)

---

## Decisions locked in (2026-06-06)

| Topic | Decision |
|-------|----------|
| **Mission source** | Default to the **currently active** DataSync mission, with a dropdown to override. |
| **Coordinates** | User **picks one CoT point** from the selected mission; that point's lat/lon fills `location`. |
| **Incident title** (`referenceDescription`) | **Empty text box, user types it** for v1. Later: scan the mission to auto-populate. |
| **`description`** | Multi-line text box (HTML-capable). |
| **`startsAt`** | A date-time field **auto-filled from the mission's creation time**, editable. Emitted as **ISO 8601 UTC** (`...Z`). |
| **`endsAt`** | Optional editable date-time; omitted if blank for v1. |
| **`reference`** (auto-id) | Team **has auto-id enabled** → `peek` the next reference and include it. |
| **`shared`** | Hardcoded `true`. |
| **`fullTeam`** | `true` by default. If false → **member-group multi-select**. |
| **Member groups** | v1: **capture the selection only** — do **not** create attendance yet. |
| **`address.*`** | All empty strings for v1. |
| **`customFieldValues`** | **Skip for v1.** Add dynamic rendering in a later phase. |
| **Write path / CORS** | **Step one is a CORS spike** — confirm whether the browser can POST to D4H before building UI. |

---

## The incident payload — field-by-field (v1)

Only **`startsAt`** is required by D4H. Everything below reflects the v1 decisions.

| Payload key | v1 value / source | Notes from swagger |
|-------------|-------------------|--------------------|
| `reference` | `peek` result from `/incidents/reference/peek` | max 30; only valid because team has auto-id enabled |
| `referenceDescription` | user-typed text box | **max 100** — *"the activity's title"*. **This is the incident name.** |
| `description` | multi-line text box | HTML, max 65535 |
| `plan` | `null` | HTML, optional |
| `trackingNumber` | `null` (v1) | max 50 |
| `shared` | `true` | boolean |
| `fullTeam` | `true` default; `false` reveals group multi-select | boolean. When `false`, D4H does **not** auto-create attendance. |
| `address` | `{ country:"", postcode:"", region:"", street:"", town:"" }` | all empty for v1 |
| `location` | `{ latitude, longitude }` from the chosen CoT point | both required **within** `location`; lat ∈ [-90,90], lon ∈ [-180,180] |
| `locationBookmarkId` | omit | |
| `startsAt` | mission creation time, editable, ISO 8601 UTC | **required** |
| `endsAt` | omit unless user enters one | |
| `customFieldValues` | omit (v1) | each item `{ id, value }`; `value` = array of option-ids **or** a string |

**Member groups are NOT part of this payload.** `GET /member-groups` returns only group
definitions (`id`, `title`). The multi-select stores the chosen group(s) for a future attendance
step (see Phase 4); it does not affect the incident body.

---

## Submit sequence (v1)

```
0. (one-time spike)  Confirm CORS allows POST from the browser.
1. POST /v3/team/<contextId>/incidents/reference/peek   → next auto-id reference
2. POST /v3/team/<contextId>/incidents                  → returns the new activityId
   (fullTeam=true auto-creates attendance for the whole team)
```

That's the whole v1 happy path. Group attendance and involved-person/injury records come later.

### Reference handling detail
With auto-id enabled: `peek` shows the next available code without consuming it. Include that
code as `reference` in the POST. If the POST rejects it as taken (race), re-`peek` and retry.
`/incidents/reference/check` and `/increment` exist if explicit reservation proves necessary —
treat as a fallback, verify against live behavior.

---

## UI layout (new "Submit Incident" tab)

1. **Mission selector** — defaults to the active DataSync mission; dropdown to override.
2. **CoT point picker** — lists the point features in the selected mission; selection sets
   `location` lat/lon. Show the resolved lat/lon read-only beside it.
3. **Title** — text input → `referenceDescription` (maxlength 100).
4. **Description** — textarea → `description`.
5. **Starts at** — date-time input, pre-filled from mission creation time (editable), stored UTC.
6. **Ends at** — optional date-time input.
7. **Full team** — toggle, default on. When off, reveal:
8. **Member-group multi-select** — a **Vue multi-select** populated from `GET /member-groups`
   (`{ id, title }`). v1 captures the selection only.
9. **Submit** — runs the sequence above; shows the returned `activityId` / errors.

`address` fields are not shown in v1 (sent as empty strings).

---

## DataSync mission + CoT point access — RESOLVED (2026-06-06)

Researched in the CloudTAK core (`api/web/...`). The critical gotcha:

> **`PluginAPI.feature.list()` does NOT see mission CoT points.** It reads `db.feature` (the
> general map layer). A DataSync mission's CoT features live in a **separate** Dexie table,
> `db.subscription_feature`, keyed by `mission` = the mission GUID.

So the plugin must reach past `PluginAPI` into the core stores/base classes — the same pattern the
roster already uses (`import KV from '../../src/base/kv.ts'`). Concretely:

- **Active mission:** `useMapStore(pinia).mission` is a `Subscription | undefined`
  (`api/web/src/stores/map.ts`). Switch with `mapStore.makeActiveMission(sub)`.
  - `import { useMapStore } from '../../src/stores/map.ts'`
- **List missions (for the override dropdown):**
  `Subscription.localList()` → `Set<{ guid, name }>` of locally-loaded missions (offline-friendly);
  `Subscription.list()` hits `/api/marti/mission` for the server list.
  - `import Subscription from '../../src/base/subscription.ts'`
- **A mission's CoT points:** the `Subscription` has a `.feature` accessor
  (`SubscriptionFeature`, `api/web/src/base/subscription-feature.ts`):
  - `await sub.feature.list()` → `Feature[]` (`{ id, path, properties, geometry }`) from
    `db.subscription_feature` where `mission == guid`.
  - `await sub.feature.collection()` → a GeoJSON `FeatureCollection`.
  - `await sub.feature.list({ refresh: true })` re-pulls from
    `/api/marti/missions/{guid}/cot` first.
  - **Filter to points** for the picker: `feats.filter(f => f.geometry?.type === 'Point')`, then
    read `f.geometry.coordinates` = `[lon, lat]` (GeoJSON order — D4H wants `latitude`/`longitude`,
    so map `coordinates[1]`→latitude, `coordinates[0]`→longitude).
- **`startsAt` default:** `mapStore.mission.meta.createTime` (ISO 8601 string on the `Mission`
  metadata) → use directly / normalize to UTC `...Z`.

Net flow for the UI:
```
mapStore.mission (active, or one chosen via Subscription.localList())
  → sub.feature.list()
  → filter geometry.type === 'Point'
  → user picks one → coordinates[1]/[0] → location.latitude/longitude
mapStore.mission.meta.createTime → startsAt default
```

## Open research items (do these as you build, don't assume)

1. **Direct core imports are an unofficial surface.** The plugin will import `useMapStore`,
   `Subscription`, and possibly `db` directly (not via `PluginAPI`), exactly like the roster's
   `KV` import. That works today but is not a stable public API — re-verify after any
   `cloudtak-core-update`. Consider proposing a `PluginAPI.mission` accessor upstream later.
2. **CORS for POST** (Phase 0 spike). Reuse the `spike/phase-0-cors/` harness. Non-credentialed,
   `Authorization: Bearer …`, **do not** set `credentials:'include'`. If blocked → server-proxy
   route (PLAN §4A/§5).
3. **Token write scope.** Confirm the configured token can create incidents, not just read.
4. **`peek` semantics.** Confirm whether `peek` alone is safe to pass into the POST or whether
   `increment`/`check` is needed to avoid duplicate-reference errors.
5. **Coordinate format.** D4H wants decimal degrees. Mission CoT points are decimal lat/lon —
   confirm no USNG/UTM conversion is needed at this layer.

---

## CORS write spike — RESOLVED (2026-06-06): writes are allowed client-side

Real `OPTIONS` preflight from origin `https://cloudtak.example.org` against
`api.team-manager.us.d4h.com` returned:

```
access-control-allow-origin:  *
access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE
access-control-allow-headers: authorization,content-type
```

→ **No server-proxy route needed for CORS.** Client-side incident submit (matching the existing
read architecture) is viable. **Constraint:** because Allow-Origin is the wildcard `*`, all write
fetches must stay **non-credentialed** — never set `credentials: 'include'`. The Bearer token
authenticates.

Open auth caveat: the spike's real GET returned **HTTP 401** (token didn't authenticate — separate
from CORS). Before live submits, confirm a valid, **write-scoped** token in `d4h-config-v1` and that
`<contextId>` is the right team id.

## Client additions — DONE (scaffolded 2026-06-06)

Added to `lib/d4h-client.ts` (typechecks clean; non-credentialed; D4H Zod errors surfaced; `.status`
tagged on thrown errors):

- `peekIncidentReference(config)` → `POST …/team/{id}/incidents/reference/peek`, returns the next
  reference string (or null). Team-scoped; no side effect.
- `createIncident(config, payload: D4HIncidentCreate)` → `POST …/{context}/{contextId}/incidents`,
  returns the created record (read `id`/`activityId` for later phases).
- `listMemberGroups(config)` → `GET …/member-groups`, returns `{ id, title }[]` for the multi-select.

Exported types: `D4HIncidentCreate`, `MemberGroupOption`.

## UI — DONE (built 2026-06-06)

New `components/SubmitIncidentView.vue`, wired into `HomeView.vue` as a third tab
("Submit Incident"). Typechecks clean under strict `vue-tsc` against the real lib types.

- Mission selector (defaults to `useMapStore().mission`, override from `db.subscription`).
- CoT point picker — reads `db.subscription_feature` by mission guid, filters `geometry.type === 'Point'`,
  maps `[lon, lat]` → `location.latitude/longitude`.
- Title (→ referenceDescription, 100-char counter), Description (→ description, nulled if blank).
- Starts-at `datetime-local` pre-filled from the mission's `meta.createTime`, shown converted to UTC `…Z`;
  optional Ends-at.
- Full-team switch; when off, a native multi-select loads `listMemberGroups()` (selection captured, not
  submitted in v1).
- Submit: `peekIncidentReference()` (best-effort — omits reference if it fails) → `createIncident()`;
  shows the new D4H id or a typed error. 401/403 renders a "token lacks write scope" hint.

## Custom fields — DONE (built 2026-06-06)

Client: `listIncidentCustomFields(config)` → `GET /custom-fields?target_resource_type=Incident`
(sorted by `ordering`); drops archived fields; normalizes to
`D4HCustomField { id, title, type, hint?, mandatory, options[] }`. Exported types
`D4HCustomField`, `D4HCustomFieldType`, `D4HCustomFieldOption`.

UI: the Submit tab loads incident fields on mount and renders inputs by type — `TEXT`/`NUMBER`/
`DATE`/`DATETIME`/`TIME` as native inputs, `TEXT_AREA` as a textarea, `SINGLE_CHOICE` as a select,
`MULTIPLE_CHOICE` as a multi-select. `mandatory` fields are enforced before submit (listed if
missing). On submit, filled fields become `customFieldValues: [{ id, value }]` — option-id arrays for
choice types, `DATETIME` converted to UTC ISO, strings otherwise. Loading is non-fatal (incident can
still submit if the field fetch fails). Typechecks clean under strict `vue-tsc`.

Verify against live data once available: the exact field-record key names from `GET /custom-fields`
(swagger documents no response body) — code reads `id/title/type/hint/mandatory/options[].id/label`
defensively, but confirm `options` is embedded (vs. a separate `/custom-field-options` fetch) and that
`NUMBER`/`DATE`/`TIME` accept plain-string values.

## Overlay → custom-field auto-fill — DONE (built 2026-06-06)

Reads ArcGIS/GeoJSON **overlay** attributes at the incident's CoT point and fills incident custom
fields. Confirmed feasible: overlays are `vector`/`geojson` with attribute popups, so
`map.queryRenderedFeatures` returns their `properties` (CloudTAK's own click handler uses the same
call). Raster overlays would need ArcGIS REST identify — out of scope.

- **Mapping**: static `lib/overlay-field-map.ts` template —
  `{ customFieldId, overlayLayerId, attribute }[]` (explicit, per the chosen approach). Ships empty
  with commented examples.
- **`lib/overlay-detect.ts`**: `inspectAtPoint()` (dumps every clickable overlay feature's layer id +
  properties — the authoring aid for discovering `overlayLayerId`/`attribute`), `detectValues()`
  (applies the mapping at the point), `clickableLayers()`, `normalizeLabel()`. Structurally typed
  (`MapLike`/`OverlayLike`) so it doesn't hard-depend on maplibre or the core `Overlay` class.
- **UI** (Submit tab, under the point picker): "Inspect overlays at point" and "Detect mapped fields".
  Both recenter the map on the point first (so the overlay tiles render there), then query. Detected
  values fill choice fields by matching the value to an option label (normalized, case-insensitive →
  selects the option id) and text fields verbatim; an applied/unmatched summary is shown.

Constraints to remember: auto-detect only sees overlays **toggled on** and **vector/geojson**; the map
recenters on detect (button-initiated). Typechecks clean under strict `vue-tsc`.

**Fix (2026-06-06): matching no longer uses `_clickable`.** The first cut queried only each overlay's
`_clickable` layer ids — often empty, or just the outline/label layer, so an interior point matched
nothing ("No clickable overlay features"). Now `inspectAtPoint`/`detectValues` query a small pixel box
and keep features whose **source** is `String(overlay.id)` (or layer id prefixed `${id}-`), independent
of the clickable flag. Added `debugAtPoint()` + a UI diagnostics panel (rendered-feature count, visible
overlays, and every layerId←source under the point) shown when nothing matches, and lengthened the
post-recenter idle wait to 4s so far jumps finish loading tiles before the query.

Next-step ideas: trigger detect automatically on point-select (not just button); raster-overlay support
via ArcGIS `/query`/`/identify`; an in-app mapping editor if hand-editing the file gets old.

Remaining for later phases: selective attendance, involved-persons/injuries, title auto-population, and
upgrading the native multi-selects to a richer Vue component.

---

## Future phases (explicitly out of scope for v1)

- **Phase: selective attendance.** When `fullTeam=false`, resolve members of the selected
  group(s) via `/member-group-memberships`, then `POST /v3/team/<contextId>/attendance` per member
  (`memberId`, `activityId`, `startsAt`, `endsAt`, `status:"ATTENDING"`).
- **Phase: custom fields.** `GET /custom-fields` (filter to the incident resource type — the
  `target_resource_type` value is **not** in the swagger, discover it live) + `/custom-field-options`;
  auto-render selects for option fields and text/number/date inputs otherwise; emit
  `customFieldValues: [{ id, value }]`.
- **Phase: involved persons + injuries.**
  `POST /incident-involved-persons` (`incidentId`, `name`, `age`, `involvementTypeId`, …) →
  `personInvolvedId`; then `POST /incident-involved-injuries` (`personInvolvedId`,
  `injuryLocationId`, `injuryTypeId` — ids come from `/incident-involved-metadata`).
- **Phase: title auto-population.** Scan the mission for key info to pre-fill the title.

---

## One-line summary

v1 = active-mission picker + CoT-point picker + title/description/start-time + shared/fullTeam,
POSTed to `/incidents` with a peeked auto-id reference — **gated on a CORS write spike first.**
Member groups (capture only), custom fields, attendance, and involved-persons/injuries are
scoped to later phases.
