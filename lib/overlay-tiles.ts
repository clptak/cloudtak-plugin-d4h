// Read overlay attributes at a point from the overlay's vector tiles, without using the map.
//
// Submit Incident Detect uses this so nobody has to add or turn on an overlay: the overlay is found in
// CloudTAK's catalog from its layer id, the tile covering the point is fetched from CloudTAK's API,
// and each mapped layer's own source layer and style filter decide which features count. Nothing is
// added to the map, the Overlays menu, or the profile.
//
// A failed read is reported separately from an empty one, so "could not check" can never look like
// "no restriction at this point". The server answers 404 for a tile with no features, so that is an
// empty read.

import { featureFilter, PbfReader, VectorTile } from '../vendor/overlay-tile.es.min.js';
import type { VectorTileLayerLike } from '../vendor/overlay-tile.es.min.js';
import { layerMatches, translateValue, type DetectResult } from './overlay-detect.ts';
import type { OverlayFieldMapping } from './overlay-field-map.ts';

export interface StyleLayer {
    id: string;
    type?: string;
    'source-layer'?: string;
    filter?: unknown;
}

export interface CatalogOverlay {
    id: number;
    styles: StyleLayer[];
}

/** The parts of a loaded CloudTAK overlay used as a fallback when the catalog has no match. */
export interface LoadedOverlay {
    type: string;
    mode: string;
    mode_id: string | null;
    styles: StyleLayer[];
    _error?: unknown;
}

export interface TileInfo {
    minzoom?: number;
    maxzoom?: number;
    /** [west, south, east, north] */
    bounds?: number[];
    scheme?: string;
}

export interface OverlayTileApi {
    /** Every vector overlay this person can read. */
    listCatalog(): Promise<CatalogOverlay[]>;
    getCatalogOverlay(id: number): Promise<CatalogOverlay>;
    tileInfo(id: number): Promise<TileInfo>;
    /** Tile bytes, or null when the server says the tile has no features. */
    fetchTile(id: number, z: number, x: number, y: number): Promise<ArrayBuffer | null>;
}

export interface OverlayTileReadResult {
    results: DetectResult[];
    /** Layer ids no readable overlay has. */
    missing: string[];
    /** Layer ids whose overlay was found but could not be read. */
    unreadable: string[];
}

/** Where to read one row from. A null style means the overlay uses CloudTAK's default style. */
interface ReadTarget {
    basemapId: number;
    style: StyleLayer | null;
}

interface DecodedTile {
    z: number;
    x: number;
    y: number;
    /** Position of the point within the tile, 0 to 1. */
    fx: number;
    fy: number;
    layers: Record<string, VectorTileLayerLike>;
}

type Attributes = Record<string, unknown>;

const MAX_LAT = 85.051129;
/** Hit distance for lines and points, as a share of the tile's extent: 4 pixels on a 512px tile. */
const NEAR_FRACTION = 4 / 512;

function rowLayerId(row: OverlayFieldMapping): string {
    return row.overlayLayerId.trim();
}

function rowKey(row: OverlayFieldMapping): string {
    return `${row.basemapId ?? ''}|${rowLayerId(row)}`;
}

function isVectorStyle(style: StyleLayer): boolean {
    return style.type !== 'raster' && style.type !== 'background';
}

function matchingStyles(styles: StyleLayer[], layerId: string): StyleLayer[] {
    return styles.filter((style) => isVectorStyle(style) && layerMatches(style.id, layerId));
}

function targetsFromCatalog(overlays: CatalogOverlay[], layerId: string): ReadTarget[] {
    return overlays.flatMap((overlay) => matchingStyles(overlay.styles, layerId)
        .map((style) => ({ basemapId: overlay.id, style })));
}

/**
 * A profile can hold its own copy of an overlay's styles, including the generated
 * `${overlay.id}-poly` ids. This keeps those rows working for the person who has that overlay.
 */
function targetsFromLoaded(overlays: LoadedOverlay[], layerId: string): ReadTarget[] {
    const targets: ReadTarget[] = [];
    for (const overlay of overlays) {
        const basemapId = Number(overlay.mode_id);
        if (overlay._error || overlay.mode !== 'overlay' || overlay.type !== 'vector') continue;
        if (!Number.isInteger(basemapId) || basemapId < 1) continue;
        for (const style of matchingStyles(overlay.styles, layerId)) {
            targets.push({ basemapId, style });
        }
    }
    return targets;
}

async function targetsFromBasemapId(
    api: OverlayTileApi,
    basemapId: number,
    layerId: string,
): Promise<ReadTarget[]> {
    const overlay = await api.getCatalogOverlay(basemapId);
    if (!overlay.styles.length) return [{ basemapId, style: null }];
    return matchingStyles(overlay.styles, layerId).map((style) => ({ basemapId, style }));
}

/** Tile coordinates at a zoom, plus the point's position within that tile. */
function locate(lonLat: [number, number], z: number, scheme?: string) {
    const lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lonLat[1])) * Math.PI / 180;
    const n = 2 ** z;
    const worldX = ((lonLat[0] + 180) / 360) * n;
    const worldY = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
    const x = Math.min(n - 1, Math.floor(worldX));
    const y = Math.min(n - 1, Math.floor(worldY));
    return {
        z,
        x,
        y,
        requestY: scheme === 'tms' ? n - 1 - y : y,
        fx: worldX - x,
        fy: worldY - y,
    };
}

function outsideBounds(lonLat: [number, number], bounds?: number[]): boolean {
    if (!bounds || bounds.length !== 4) return false;
    const [west, south, east, north] = bounds;
    return lonLat[0] < west || lonLat[0] > east || lonLat[1] < south || lonLat[1] > north;
}

async function loadTile(
    api: OverlayTileApi,
    basemapId: number,
    lonLat: [number, number],
): Promise<DecodedTile | null> {
    const info = await api.tileInfo(basemapId);
    if (outsideBounds(lonLat, info.bounds)) return null;
    if (typeof info.maxzoom !== 'number') throw new Error(`Overlay ${basemapId} has no maximum zoom`);

    const place = locate(lonLat, Math.floor(info.maxzoom), info.scheme);
    const bytes = await api.fetchTile(basemapId, place.z, place.x, place.requestY);
    if (!bytes || !bytes.byteLength) return null;

    const tile = new VectorTile(new PbfReader(new Uint8Array(bytes)));
    return {
        z: place.z,
        x: place.x,
        y: place.y,
        fx: place.fx,
        fy: place.fy,
        layers: tile.layers,
    };
}

type Point = { x: number; y: number };

/** Even-odd across every ring, which covers holes and multi-part polygons. */
function polygonContains(rings: Point[][], x: number, y: number): boolean {
    let inside = false;
    for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i];
            const b = ring[j];
            if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
                inside = !inside;
            }
        }
    }
    return inside;
}

function nearSegment(a: Point, b: Point, x: number, y: number, tolerance: number): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared
        ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared))
        : 0;
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) <= tolerance;
}

function nearLine(lines: Point[][], x: number, y: number, tolerance: number): boolean {
    return lines.some((line) => line.some((point, i) => i > 0
        && nearSegment(line[i - 1], point, x, y, tolerance)));
}

function nearPoint(points: Point[][], x: number, y: number, tolerance: number): boolean {
    return points.some((part) => part.some((p) => Math.hypot(p.x - x, p.y - y) <= tolerance));
}

/** Does this geometry count as being at the point, the way this style layer would draw it? */
function hits(
    styleType: string | undefined,
    geometryType: number,
    geometry: Point[][],
    x: number,
    y: number,
    tolerance: number,
): boolean {
    if (styleType === 'fill' || styleType === 'fill-extrusion') {
        return geometryType === 3 && polygonContains(geometry, x, y);
    }
    if (styleType === 'line') {
        return geometryType !== 1 && nearLine(geometry, x, y, tolerance);
    }
    if (geometryType === 3) return !styleType && polygonContains(geometry, x, y);
    if (geometryType === 2) return !styleType && nearLine(geometry, x, y, tolerance);
    return nearPoint(geometry, x, y, tolerance);
}

function featuresAtPoint(tile: DecodedTile, style: StyleLayer | null): Attributes[] {
    const filter = style?.filter === undefined ? null : featureFilter(style.filter, 'filter').filter;
    const sourceLayer = style?.['source-layer'];
    const layers = sourceLayer ? [tile.layers[sourceLayer]] : Object.values(tile.layers);
    const out: Attributes[] = [];

    for (const layer of layers) {
        if (!layer) continue; // A tile leaves out source layers with nothing in that area.
        const x = tile.fx * layer.extent;
        const y = tile.fy * layer.extent;
        const tolerance = layer.extent * NEAR_FRACTION;

        for (let i = 0; i < layer.length; i++) {
            const feature = layer.feature(i);
            const geometry = feature.loadGeometry();
            if (!hits(style?.type, feature.type, geometry, x, y, tolerance)) continue;
            const passes = !filter || filter(
                { zoom: tile.z },
                { type: feature.type, id: feature.id, properties: feature.properties, geometry },
                { z: tile.z, x: tile.x, y: tile.y },
            );
            if (passes) out.push(feature.properties);
        }
    }
    return out;
}

function firstValue(row: OverlayFieldMapping, features: Attributes[]): string | null {
    for (const properties of features) {
        const raw = properties[row.attribute];
        if (raw != null && raw !== '') return translateValue(String(raw), row.valueMap);
    }
    return null;
}

/** Read every row's attribute at the point. Rows are returned in the order they were given. */
export async function readOverlaysAtPoint(
    lonLat: [number, number],
    mapping: OverlayFieldMapping[],
    api: OverlayTileApi,
    loaded: LoadedOverlay[] = [],
): Promise<OverlayTileReadResult> {
    const rows = mapping.filter((row) => rowLayerId(row));
    const catalog = rows.some((row) => row.basemapId === undefined) ? await api.listCatalog() : [];

    const tiles = new Map<number, Promise<DecodedTile | null>>();
    const tileFor = (basemapId: number): Promise<DecodedTile | null> => {
        let tile = tiles.get(basemapId);
        if (!tile) {
            tile = loadTile(api, basemapId, lonLat);
            tiles.set(basemapId, tile);
        }
        return tile;
    };

    const missing = new Set<string>();
    const unreadable = new Set<string>();
    const featuresByRow = new Map<string, Attributes[]>();

    await Promise.all([...new Map(rows.map((row) => [rowKey(row), row])).values()].map(async (row) => {
        const layerId = rowLayerId(row);
        try {
            let targets: ReadTarget[];
            if (row.basemapId !== undefined) {
                targets = await targetsFromBasemapId(api, row.basemapId, layerId);
            } else {
                targets = targetsFromCatalog(catalog, layerId);
                if (!targets.length) targets = targetsFromLoaded(loaded, layerId);
            }

            if (!targets.length) {
                missing.add(layerId);
                return;
            }

            const found = await Promise.all(targets.map(async (target) => {
                const tile = await tileFor(target.basemapId);
                return tile ? featuresAtPoint(tile, target.style) : [];
            }));
            featuresByRow.set(rowKey(row), found.flat());
        } catch (err) {
            console.error(`D4H Detect could not read overlay layer ${layerId}:`, err);
            unreadable.add(layerId);
        }
    }));

    return {
        results: rows.map((row) => ({
            customFieldId: row.customFieldId,
            overlayLayerId: row.overlayLayerId,
            attribute: row.attribute,
            value: firstValue(row, featuresByRow.get(rowKey(row)) ?? []),
        })),
        missing: [...missing],
        unreadable: [...unreadable],
    };
}
