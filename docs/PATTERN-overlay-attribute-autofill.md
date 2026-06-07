# Pattern: auto-fill a form field from an overlay attribute at a point

_Reusable recipe extracted from the D4H plugin's Submit-Incident overlay detection. Drop this into any
CloudTAK plugin (e.g. `cloudtak-plugin-skydio`) where you have a form field and want it populated from a
map overlay's attribute under a given lon/lat. This is the **generic** version — no D4H value-mapping,
just "read attribute X from overlay layer Y at this point and put it in my field."_

---

## What it does

Given a point (lon/lat) and a vector/GeoJSON overlay that's toggled on, it reads a chosen attribute
from the overlay feature under that point and returns the value — which you then write into a form field.

It works because CloudTAK renders overlays as MapLibre sources, so `map.queryRenderedFeatures()` returns
their `properties`. This is the same call CloudTAK's own map-click handler uses.

## Key facts learned (so you don't re-derive them)

- **Mission/overlay data is reached through the core stores, not `PluginAPI`.** `PluginAPI.feature` only
  sees the general map layer. For overlays you import the core map store directly (same pattern as other
  plugins importing `KV`/`db`).
- **Do NOT depend on the map store's `overlays` list.** Inside a plugin, `useMapStore().overlays` can
  come back **empty** even while the overlay layers are clearly rendered on the map. (This burned us: a
  Wilderness overlay rendered fine but `overlays` reported "none", so any code that filtered features
  against that list found nothing.) Identify overlay features straight from `queryRenderedFeatures` by
  their layer-id shape — anything whose id matches `^\d+-` is an overlay layer (`${overlay.id}-…`).
  Don't use the `_clickable` list either (often empty / only the outline layer).
- **The leading number in a layer id changes on restart.** Layer ids are `${overlay.id}-${original}`
  and `overlay.id` is reassigned each restart, so `1202-136-poly` becomes `1530-136-poly`. Match on the
  STABLE suffix (`136-poly`) by stripping a leading `^\d+-`, never the full id.
- **Suffixes are case-sensitive and similar layers differ in attribute keys.** Two overlays can look
  alike but use different property names — e.g. `Wilderness-poly` exposes `wildernessname` while a
  separate `wilderness-poly` exposes `NAME`. Always confirm the attribute key on the *specific* layer
  via Inspect; don't assume.
- **Query a small pixel box, not a single pixel** — tolerates thin geometries and exact-pixel misses.
- **Recenter the map on the point first and wait for `idle`** — `queryRenderedFeatures` only sees tiles
  rendered in the current viewport, so an off-screen point returns nothing until its tiles load.
- **Only vector/geojson overlays carry attributes.** Raster (ArcGIS MapServer/ImageServer image)
  overlays return nothing — you'd need an ArcGIS REST `identify`/`query` call instead (not covered here).
- These core imports are an **unofficial surface** — re-verify after a CloudTAK core update.

## Import-depth note

The core store path depends on how deep your file is under the plugin root
(`api/web/plugins/<your-plugin>/`):

- A file directly in the plugin root → `../../src/stores/map.ts`
- A file in a subfolder like `lib/` or `components/` → `../../../src/stores/map.ts`

Adjust the `../` count to match where you put the files below.

---

## Step 1 — drop in the helper (`lib/overlay-attribute.ts`)

Plugin-agnostic. No dependency on maplibre-gl or the core `Overlay` class (uses minimal structural
types), so it typechecks anywhere.

```ts
// lib/overlay-attribute.ts
// Read attributes from CloudTAK vector/geojson overlays at a point.

type PixelBox = [[number, number], [number, number]];

interface RenderedFeature {
    layer: { id: string };
    source?: string;
    properties: Record<string, unknown> | null;
}

/** Minimal structural map type — the real MapLibre map satisfies it. */
export interface MapLike {
    project(lnglat: [number, number]): { x: number; y: number };
    queryRenderedFeatures(
        geometry?: { x: number; y: number } | PixelBox,
        options?: { layers?: string[] },
    ): RenderedFeature[];
}

/** Minimal structural overlay type — the core Overlay class satisfies it. */
export interface OverlayLike {
    id: number;
    name: string;
    visible?: boolean;
    type?: string;
}

export interface InspectResult {
    layerId: string;        // full runtime id, e.g. "1202-136-poly" (leading number changes on restart)
    stableLayerId: string;  // use THIS in your config, e.g. "136-poly"
    source: string;         // overlay source id (the volatile leading number), for reference
    properties: Record<string, unknown>;
}

export interface OverlayDebug {
    totalFeaturesAtPoint: number;
    sampleLayers: Array<{ layerId: string; source: string }>;
    visibleOverlays: Array<{ id: number; name: string; type?: string }>;
}

const BOX_HALF = 4; // pixels

function boxAround(map: MapLike, lonLat: [number, number]): PixelBox {
    const p = map.project(lonLat);
    return [[p.x - BOX_HALF, p.y - BOX_HALF], [p.x + BOX_HALF, p.y + BOX_HALF]];
}

/** Strip the volatile leading overlay-id prefix: "1202-136-poly" -> "136-poly". */
export function layerSuffix(id: string): string {
    return id.replace(/^\d+-/, '');
}

function visibleOverlays(overlays: OverlayLike[]): OverlayLike[] {
    return overlays.filter((o) => o.visible !== false);
}

/**
 * Read a single attribute from an overlay layer at the point.
 * Pass the STABLE layer id ("136-poly") or a full one ("1202-136-poly") — the leading overlay-id
 * prefix is ignored, so this keeps working after restarts. Returns the value, or null if nothing's there.
 */
export function readAttributeAtPoint(
    map: MapLike,
    lonLat: [number, number],
    layerId: string,
    attribute: string,
): string | null {
    const wantSuffix = layerSuffix(layerId);
    const feats = map.queryRenderedFeatures(boxAround(map, lonLat));
    for (const f of feats) {
        if (layerSuffix(f.layer.id) !== wantSuffix) continue;
        const raw = (f.properties ?? {})[attribute];
        if (raw != null && raw !== '') return String(raw);
    }
    return null;
}

/**
 * Dump every rendered OVERLAY feature under the point — use this to discover layerId + attribute keys.
 * Does NOT depend on the map store's overlays list (which can be empty inside a plugin); it keeps any
 * rendered layer whose id has the `${overlayId}-…` shape, so it works even when `overlays` reports none.
 */
export function inspectAtPoint(
    map: MapLike,
    lonLat: [number, number],
): InspectResult[] {
    const feats = map.queryRenderedFeatures(boxAround(map, lonLat));
    const out: InspectResult[] = [];
    const seen = new Set<string>();
    for (const f of feats) {
        if (!/^\d+-/.test(f.layer.id)) continue; // overlay layers only (skip basemap)
        const key = `${layerSuffix(f.layer.id)}|${JSON.stringify(f.properties ?? {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            layerId: f.layer.id,
            stableLayerId: layerSuffix(f.layer.id),
            source: f.source ?? '',
            properties: (f.properties ?? {}) as Record<string, unknown>,
        });
    }
    return out;
}

/** What is actually rendered under the point — for diagnosing "nothing matched". */
export function debugAtPoint(
    map: MapLike,
    overlays: OverlayLike[],
    lonLat: [number, number],
): OverlayDebug {
    const feats = map.queryRenderedFeatures(boxAround(map, lonLat));
    const seen = new Set<string>();
    const sampleLayers: Array<{ layerId: string; source: string }> = [];
    for (const f of feats) {
        const k = `${f.layer.id}|${f.source ?? ''}`;
        if (seen.has(k)) continue;
        seen.add(k);
        sampleLayers.push({ layerId: f.layer.id, source: f.source ?? '' });
        if (sampleLayers.length >= 40) break;
    }
    return {
        totalFeaturesAtPoint: feats.length,
        sampleLayers,
        visibleOverlays: visibleOverlays(overlays).map((o) => ({ id: o.id, name: o.name, type: o.type })),
    };
}
```

## Step 2 — wire it into your form component

In your `<script setup>`:

```ts
import { ref } from 'vue';
import { useMapStore } from '../../../src/stores/map.ts'; // adjust ../ depth
import {
    readAttributeAtPoint,
    inspectAtPoint,
    debugAtPoint,
    type MapLike,
    type OverlayLike,
} from '../lib/overlay-attribute.ts';

// The form field you want to auto-fill:
const myField = ref('');

// Where your point comes from is up to you — a clicked CoT feature, a fixed marker,
// a lat/lon input, etc. Here it's just a tuple [lon, lat].
function pointLonLat(): [number, number] {
    return [/* lon */ -111.79, /* lat */ 34.86];
}

// Recenter the map on the point, wait for tiles to render, then run a callback.
type RecenterMap = MapLike & {
    jumpTo(opts: { center: [number, number] }): void;
    once(ev: string, cb: () => void): void;
};

async function recenterTo(lonLat: [number, number]): Promise<MapLike | null> {
    const map = useMapStore().map as unknown as RecenterMap | undefined;
    if (!map) return null;
    map.jumpTo({ center: lonLat });
    await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        map.once('idle', done);
        setTimeout(done, 4000); // fallback if 'idle' never fires
    });
    return map;
}

function overlays(): OverlayLike[] {
    return (useMapStore().overlays ?? []) as unknown as OverlayLike[];
}

// ── The actual auto-fill: read attribute `districtname` from layer `1202-136-poly` ──
async function autofill(): Promise<void> {
    const lonLat = pointLonLat();
    const map = await recenterTo(lonLat);
    if (!map) return;
    const value = readAttributeAtPoint(map, lonLat, '136-poly', 'districtname'); // stable id (no leading overlay number)
    if (value != null) myField.value = value;
}

// One-time discovery helper: log what's under the point so you can find layerId + attribute.
async function inspect(): Promise<void> {
    const lonLat = pointLonLat();
    const map = await recenterTo(lonLat);
    if (!map) return;
    const hits = inspectAtPoint(map, lonLat);            // no overlays arg — queries rendered layers directly
    console.log('overlay features at point:', hits);     // each: { stableLayerId, source, properties }
    if (!hits.length) console.log('debug:', debugAtPoint(map, overlays(), lonLat));
}
```

Trigger `autofill()` however you like — a button, or a `watch` on whatever sets the point (so it fills
the moment a point is chosen):

```ts
import { watch } from 'vue';
const selectedPoint = ref<[number, number] | null>(null);
watch(selectedPoint, (p) => { if (p) void autofill(); });
```

## Step 3 — discover the `layerId` and `attribute` (one time)

You can't guess these. Add a temporary **Inspect** button that calls `inspect()` above. Make sure the
overlay is toggled **on**, pick a point inside it, click Inspect, and read the console (or render the
results): each entry shows the **`stableLayerId`** (e.g. `136-poly` — use this), the full `layerId`, the
`source`, and every **property key: value**. Plug the `stableLayerId` and the property key you want into
`readAttributeAtPoint`. If two layers look similar, double-check you're reading the key off the *right*
one (the `Wilderness-poly`/`wildernessname` vs `wilderness-poly`/`NAME` trap).

## Optional — translate the overlay value before storing it

If your form needs a different string than the overlay carries (e.g. the overlay says
`Red Rock Ranger District` but your record needs `USFS COCONINO-RED ROCK RANGER DISTRICT`), add a small
lookup before assigning:

```ts
const VALUE_MAP: Record<string, string> = {
    'Red Rock Ranger District': 'USFS COCONINO-RED ROCK RANGER DISTRICT',
};
const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
function translate(v: string): string {
    const hit = Object.entries(VALUE_MAP).find(([k]) => norm(k) === norm(v));
    return hit ? hit[1] : v;
}
// myField.value = translate(value);
```

(That translation table is exactly what the D4H plugin uses to match overlay labels to D4H dropdown
options — skip it if your field just wants the raw overlay value.)

## Gotchas checklist

- Overlay must be **toggled on** and be a **vector/geojson** layer (raster = no attributes).
- **Don't trust `useMapStore().overlays`** — it can be empty in a plugin even when layers render. The
  helper identifies overlay layers by the `^\d+-` id shape instead, so it doesn't matter.
- Use the **`stableLayerId`** (suffix, no leading number) in your config — the full id changes on restart.
- **Verify the attribute key on the exact layer** — similar-looking layers can carry different keys
  (`wildernessname` vs `NAME`). Inspect shows the properties per layer; copy from the right one.
- The map **recenters** on the point each time (needed to render the tiles). If that's disruptive and
  your point is usually already on screen, you can skip `recenterTo` and call `readAttributeAtPoint`
  directly — it just won't work for off-screen points.
- Fix the **import depth** (`../` count) to match where you place the files.
- If `inspect()` returns nothing, check `debugAtPoint` output: it tells you how many features are
  rendered there and every `layerId ← source` — enough to see whether it's "nothing rendered" vs
  "rendered under a layer id you didn't expect."
```
