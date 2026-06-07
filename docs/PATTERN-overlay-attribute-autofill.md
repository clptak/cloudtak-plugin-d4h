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
- **Match overlay features by SOURCE, not the overlay's `_clickable` list.** `_clickable` is often empty,
  or only the outline/label layer, so an interior point matches nothing. CloudTAK sets each overlay
  layer's `source` to `String(overlay.id)` — filter on that (or a `${id}-` layer-id prefix).
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
    layerId: string;
    overlayName: string;
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

function visibleOverlays(overlays: OverlayLike[]): OverlayLike[] {
    return overlays.filter((o) => o.visible !== false);
}

function overlayForFeature(f: RenderedFeature, overlays: OverlayLike[]): OverlayLike | undefined {
    for (const o of overlays) {
        const sid = String(o.id);
        if (f.source === sid) return o;
        if (f.layer.id === sid || f.layer.id.startsWith(`${sid}-`)) return o;
    }
    return undefined;
}

/**
 * Read a single attribute from a specific overlay layer at the point.
 * Returns the value as a string, or null if nothing is there.
 */
export function readAttributeAtPoint(
    map: MapLike,
    lonLat: [number, number],
    layerId: string,
    attribute: string,
): string | null {
    const feats = map.queryRenderedFeatures(boxAround(map, lonLat), { layers: [layerId] });
    for (const f of feats) {
        if (f.layer.id !== layerId) continue;
        const raw = (f.properties ?? {})[attribute];
        if (raw != null && raw !== '') return String(raw);
    }
    return null;
}

/** Dump every overlay feature under the point — use this to discover layerId + attribute keys. */
export function inspectAtPoint(
    map: MapLike,
    overlays: OverlayLike[],
    lonLat: [number, number],
): InspectResult[] {
    const vis = visibleOverlays(overlays);
    const feats = map.queryRenderedFeatures(boxAround(map, lonLat));
    const out: InspectResult[] = [];
    const seen = new Set<string>();
    for (const f of feats) {
        const ov = overlayForFeature(f, vis);
        if (!ov) continue;
        const key = `${f.layer.id}|${JSON.stringify(f.properties ?? {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ layerId: f.layer.id, overlayName: ov.name, properties: (f.properties ?? {}) as Record<string, unknown> });
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
    const value = readAttributeAtPoint(map, lonLat, '1202-136-poly', 'districtname');
    if (value != null) myField.value = value;
}

// One-time discovery helper: log what's under the point so you can find layerId + attribute.
async function inspect(): Promise<void> {
    const lonLat = pointLonLat();
    const map = await recenterTo(lonLat);
    if (!map) return;
    const hits = inspectAtPoint(map, overlays(), lonLat);
    console.log('overlay features at point:', hits);
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
results): each entry shows the overlay name, the **`layerId`** (e.g. `1202-136-poly`), and every
**property key: value**. Plug the layer id and the property key you want into `readAttributeAtPoint`.

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
- Match by **source/prefix**, not `_clickable` — already handled in the helper.
- The map **recenters** on the point each time (needed to render the tiles). If that's disruptive and
  your point is usually already on screen, you can skip `recenterTo` and call `readAttributeAtPoint`
  directly — it just won't work for off-screen points.
- Fix the **import depth** (`../` count) to match where you place the files.
- If `inspect()` returns nothing, check `debugAtPoint` output: it tells you how many features are
  rendered there, which overlays are on (with ids/types), and every `layerId ← source` — enough to see
  whether it's "nothing rendered" vs "rendered under a different source id."
```
