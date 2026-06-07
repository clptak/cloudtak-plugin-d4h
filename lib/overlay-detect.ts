// Query ArcGIS/GeoJSON overlay attributes at a point, for the Submit Incident tab.
//
// Mechanism: project the point's lon/lat to a screen pixel, query a small box around it with
// map.queryRenderedFeatures(box), then keep features that belong to one of the user's overlays.
// "Belongs to an overlay" is decided by the feature's SOURCE id (CloudTAK sets each overlay layer's
// source to String(overlay.id)) or a layer-id prefix `${overlay.id}-`. This deliberately does NOT
// depend on the overlay's `_clickable` list (often empty, or only the outline/label layer), which is
// why an interior point previously matched nothing.
//
// Only vector/geojson overlays that are toggled ON carry attributes; raster (MapServer image)
// overlays return nothing here.

import type { OverlayFieldMapping } from './overlay-field-map.ts';

type PixelBox = [[number, number], [number, number]];

interface RenderedFeature {
    layer: { id: string };
    source?: string;
    properties: Record<string, unknown> | null;
}

// Minimal structural map type so this module doesn't hard-depend on maplibre-gl.
export interface MapLike {
    project(lnglat: [number, number]): { x: number; y: number };
    queryRenderedFeatures(
        geometry?: { x: number; y: number } | PixelBox,
        options?: { layers?: string[] },
    ): RenderedFeature[];
}

export interface OverlayLike {
    id: number;
    name: string;
    visible?: boolean;
    type?: string;
    _clickable?: Array<{ id: string; type: string }>;
}

export interface InspectResult {
    /** Full runtime layer id, e.g. "1202-136-poly" (the leading number changes on restart). */
    layerId:     string;
    /** Stable id with the volatile overlay-id prefix stripped, e.g. "136-poly". USE THIS in the map. */
    stableLayerId: string;
    overlayName: string;
    properties:  Record<string, unknown>;
}

/**
 * Strip the volatile leading overlay-id prefix from a layer id.
 * CloudTAK builds layer ids as `${overlay.id}-${originalLayerId}`, and `overlay.id` is reassigned on
 * restart — so "1202-136-poly" and "1530-136-poly" are the same layer. We match on "136-poly".
 */
export function layerSuffix(id: string): string {
    return id.replace(/^\d+-/, '');
}

export interface DetectResult {
    customFieldId:  number;
    overlayLayerId: string;
    attribute:      string;
    /** Raw value read from the overlay feature, or null if nothing matched at the point. */
    value:          string | null;
}

/** Diagnostics for when nothing matches — surfaced in the UI to debug mappings. */
export interface DetectDebug {
    totalFeaturesAtPoint: number;
    /** layer id + source for every rendered feature under the point (deduped, capped). */
    sampleLayers:         Array<{ layerId: string; source: string }>;
    visibleOverlays:      Array<{ id: number; name: string; type?: string }>;
}

const BOX_HALF = 4; // pixels — tolerates thin geometries / exact-pixel misses

function boxAround(map: MapLike, lonLat: [number, number]): PixelBox {
    const p = map.project(lonLat);
    return [[p.x - BOX_HALF, p.y - BOX_HALF], [p.x + BOX_HALF, p.y + BOX_HALF]];
}

function visibleOverlays(overlays: OverlayLike[]): OverlayLike[] {
    return overlays.filter((o) => o.visible !== false);
}

/** Which overlay (if any) a rendered feature belongs to — by source id or layer-id prefix. */
function overlayForFeature(f: RenderedFeature, overlays: OverlayLike[]): OverlayLike | undefined {
    for (const o of overlays) {
        const sid = String(o.id);
        if (f.source === sid) return o;
        if (f.layer.id === sid || f.layer.id.startsWith(`${sid}-`)) return o;
    }
    return undefined;
}

/** Dump every overlay feature under the point — used to author the mapping. */
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
        out.push({
            layerId:       f.layer.id,
            stableLayerId: layerSuffix(f.layer.id),
            overlayName:   ov.name,
            properties:    (f.properties ?? {}) as Record<string, unknown>,
        });
    }
    return out;
}

/** Diagnostics: what's actually rendered under the point, regardless of overlay membership. */
export function debugAtPoint(
    map: MapLike,
    overlays: OverlayLike[],
    lonLat: [number, number],
): DetectDebug {
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

/** Apply the static mapping at the point: read each mapped attribute from its overlay layer. */
export function detectValues(
    map: MapLike,
    overlays: OverlayLike[],
    lonLat: [number, number],
    mapping: OverlayFieldMapping[],
): DetectResult[] {
    if (!mapping.length) return [];
    const feats = map.queryRenderedFeatures(boxAround(map, lonLat));

    // Key by the STABLE layer suffix so matches survive restarts (the leading overlay-id changes).
    // First feature per suffix wins (one area feature per overlay at a point).
    const bySuffix = new Map<string, Record<string, unknown>>();
    for (const f of feats) {
        const suf = layerSuffix(f.layer.id);
        if (!bySuffix.has(suf)) bySuffix.set(suf, (f.properties ?? {}) as Record<string, unknown>);
    }

    return mapping.map((m) => {
        // Accept either a full id ("1202-136-poly") or just the stable part ("136-poly") in the map file.
        const props = bySuffix.get(layerSuffix(m.overlayLayerId));
        const raw = props ? props[m.attribute] : undefined;
        const rawStr = raw == null || raw === '' ? null : String(raw);
        const value = rawStr == null ? null : translateValue(rawStr, m.valueMap);
        return { customFieldId: m.customFieldId, overlayLayerId: m.overlayLayerId, attribute: m.attribute, value };
    });
}

/** Translate an overlay value to its D4H equivalent via the row's valueMap (normalized key match). */
function translateValue(raw: string, valueMap?: Record<string, string>): string {
    if (!valueMap) return raw;
    const norm = normalizeLabel(raw);
    for (const [k, v] of Object.entries(valueMap)) {
        if (normalizeLabel(k) === norm) return v;
    }
    return raw; // unmapped → pass through (may still match a D4H option directly)
}

/** Normalize for option-label matching: lowercase, trim, collapse internal whitespace. */
export function normalizeLabel(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
}
