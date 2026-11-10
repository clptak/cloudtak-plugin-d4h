// CloudTAK API calls behind lib/overlay-tiles.ts (copied from cloudtak-plugin-skydio).

import { getRuntimeToken, server, stdurl } from '../../../src/std.ts';
import type { CatalogOverlay, OverlayTileApi, StyleLayer, TileInfo } from './overlay-tiles.ts';

const PAGE_SIZE = 100; // The API's maximum.
const TILE_TIMEOUT_MS = 20000;

function failure(error: unknown, fallback: string): Error {
    const message = (error as { message?: unknown } | undefined)?.message;
    return new Error(typeof message === 'string' && message ? message : fallback);
}

function toCatalogOverlay(item: { id: number; styles?: unknown[] }): CatalogOverlay {
    return { id: item.id, styles: (item.styles ?? []) as StyleLayer[] };
}

/** One folder of the catalog. Without a collection this also returns the folder names. */
async function listCollection(
    collection?: string,
): Promise<{ overlays: CatalogOverlay[]; collections: string[] }> {
    const overlays: CatalogOverlay[] = [];
    let collections: string[] = [];

    for (let page = 0; ; page++) {
        const { data, error } = await server.GET('/api/basemap', {
            params: {
                query: {
                    filter: '',
                    collection,
                    overlay: true,
                    type: 'vector',
                    limit: PAGE_SIZE,
                    page,
                    order: 'asc',
                    sort: 'name',
                    hidden: 'all',
                },
            },
        });
        if (error || !data) throw failure(error, 'Could not list the overlay catalog');

        overlays.push(...data.items.map(toCatalogOverlay));
        if (page === 0) collections = data.collections.map((entry) => entry.name);
        if (!data.items.length || overlays.length >= data.total) break;
    }

    return { overlays, collections };
}

export const overlayTileApi: OverlayTileApi = {
    async listCatalog() {
        const top = await listCollection();
        const folders = await Promise.all(top.collections.map((name) => listCollection(name)));
        return [...top.overlays, ...folders.flatMap((folder) => folder.overlays)];
    },

    async getCatalogOverlay(id) {
        const { data, error } = await server.GET('/api/basemap/{:basemapid}', {
            params: {
                path: { ':basemapid': id },
                query: { download: false, format: 'json' },
            },
        });
        if (error || !data) throw failure(error, `Could not read overlay ${id}`);
        return toCatalogOverlay(data as { id: number; styles?: unknown[] });
    },

    async tileInfo(id) {
        const { data, error } = await server.GET('/api/basemap/{:basemapid}/tiles', {
            params: { path: { ':basemapid': id }, query: {} },
        });
        if (error || !data) throw failure(error, `Could not read tile details for overlay ${id}`);
        return data as TileInfo;
    },

    // Plain fetch: CloudTAK's client reports every 404 as an app error, and a 404 here is normal.
    async fetchTile(id, z, x, y) {
        const token = await getRuntimeToken();
        const res = await fetch(stdurl(`/api/basemap/${id}/tiles/${z}/${x}/${y}`), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
        });
        if (res.status === 404 || res.status === 204) return null;
        if (!res.ok) throw new Error(`Tile request for overlay ${id} returned HTTP ${res.status}`);
        return res.arrayBuffer();
    },
};
