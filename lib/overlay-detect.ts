// Query ArcGIS/GeoJSON overlay attributes at a point, for the Submit Incident tab.
//
// Mechanism (mirrors CloudTAK's own map click handler in stores/map.ts): project the point's
// lon/lat to a screen pixel, then map.queryRenderedFeatures(pixel, { layers }) restricted to the
// overlays' clickable layer ids. Only works for overlays that are toggled ON and rendered at the
// point — vector/geojson overlays carry attributes; raster (MapServer image) overlays do not.

import type { OverlayFieldMapping } from './overlay-field-map.ts';

// Minimal structural types so this module doesn't hard-depend on maplibre-gl / the core Overlay class.
export interface MapLike {
    project(lnglat: [number, number]): { x: number; y: number };
    queryRenderedFeatures(
        geometry?: { x: number; y: number },
        options?: { layers?: string[] },
    ): Array<{
        layer: { id: string };
        properties: Record<string, unknown> | null;
    }>;
}

export interface OverlayLike {
    id: number;
    name: string;
    visible?: boolean;
    type?: string;
    _clickable?: Array<{ id: string; type: string }>;
}

export interface InspectResult {
    layerId:     string;
    overlayName: string;
    properties:  Record<string, unknown>;
}

export interface DetectResult {
    customFieldId:  number;
    overlayLayerId: string;
    attribute:      string;
    /** Raw value read from the overlay feature, or null if nothing matched at the point. */
    value:          string | null;
}

/** Clickable layer ids across overlays (optionally only those toggled on), with their overlay name. */
export function clickableLayers(
    overlays: OverlayLike[],
    onlyVisible = true,
): Array<{ layerId: string; overlayName: string }> {
    const out: Array<{ layerId: string; overlayName: string }> = [];
    for (const ov of overlays) {
        if (onlyVisible && ov.visible === false) continue;
        for (const c of ov._clickable ?? []) {
            out.push({ layerId: c.id, overlayName: ov.name });
        }
    }
    return out;
}

/** Dump every clickable overlay feature under the point — used to author the mapping. */
export function inspectAtPoint(
    map: MapLike,
    overlays: OverlayLike[],
    lonLat: [number, number],
): InspectResult[] {
    const layers = clickableLayers(overlays, true);
    if (!layers.length) return [];
    const byLayer = new Map(layers.map((l) => [l.layerId, l.overlayName]));

    const pixel = map.project(lonLat);
    const feats = map.queryRenderedFeatures(pixel, { layers: layers.map((l) => l.layerId) });

    const out: InspectResult[] = [];
    for (const f of feats) {
        out.push({
            layerId:     f.layer.id,
            overlayName: byLayer.get(f.layer.id) ?? f.layer.id,
            properties:  (f.properties ?? {}) as Record<string, unknown>,
        });
    }
    return out;
}

/** Apply the static mapping at the point: read each mapped attribute from its overlay layer. */
export function detectValues(
    map: MapLike,
    overlays: OverlayLike[],
    lonLat: [number, number],
    mapping: OverlayFieldMapping[],
): DetectResult[] {
    if (!mapping.length) return [];
    const wantedLayerIds = Array.from(new Set(mapping.map((m) => m.overlayLayerId)));
    const pixel = map.project(lonLat);
    const feats = map.queryRenderedFeatures(pixel, { layers: wantedLayerIds });

    // First feature per layer id wins (clickable overlays render one feature per area at a point).
    const byLayer = new Map<string, Record<string, unknown>>();
    for (const f of feats) {
        if (!byLayer.has(f.layer.id)) byLayer.set(f.layer.id, (f.properties ?? {}) as Record<string, unknown>);
    }

    return mapping.map((m) => {
        const props = byLayer.get(m.overlayLayerId);
        const raw = props ? props[m.attribute] : undefined;
        const value = raw == null || raw === '' ? null : String(raw);
        return { customFieldId: m.customFieldId, overlayLayerId: m.overlayLayerId, attribute: m.attribute, value };
    });
}

/** Normalize for option-label matching: lowercase, trim, collapse internal whitespace. */
export function normalizeLabel(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, ' ');
}
