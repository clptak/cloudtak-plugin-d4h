// Minimal type surface used by lib/overlay-tiles.ts. See vendor/README.md.

export class PbfReader {
    constructor(buf: Uint8Array | ArrayBuffer);
}

export interface VectorTileFeatureLike {
    /** 1 = point, 2 = line, 3 = polygon. */
    type: 0 | 1 | 2 | 3;
    id?: number;
    properties: Record<string, string | number | boolean>;
    loadGeometry(): Array<Array<{ x: number; y: number }>>;
}

export interface VectorTileLayerLike {
    extent: number;
    length: number;
    feature(index: number): VectorTileFeatureLike;
}

export class VectorTile {
    constructor(pbf: PbfReader);
    layers: Record<string, VectorTileLayerLike>;
}

export function featureFilter(filter: unknown, rootKey: string): {
    filter(
        globalProperties: { zoom: number },
        feature: {
            type: number;
            id?: number;
            properties: Record<string, unknown>;
            geometry: Array<Array<{ x: number; y: number }>>;
        },
        canonical?: { z: number; x: number; y: number },
    ): boolean;
    needGeometry: boolean;
};
