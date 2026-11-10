// Show the overlay layers that Detect needs while it reads them, then hide them again.
//
// This works on the map only: it flips each MapLibre layer's `visibility` layout property, the
// same way CloudTAK applies visibility in Overlay.addLayers(). It never calls overlay.update(),
// so nothing is saved to the server (no PATCH /api/profile/overlay per pick), the overlay's
// on/off switch in CloudTAK does not change, and other devices are unaffected.
//
// Overlays that are hidden in CloudTAK keep their layers on the map with visibility "none", so
// they can be shown. An overlay that is not added to the user's map at all has no layers, and is
// reported as missing.

import { layerMatches } from './overlay-detect.ts';

export interface EnsurableOverlay {
    name: string;
    visible: boolean;
    styles: Array<{ id: string; type?: string }>;
    /** Set by CloudTAK when an overlay's tiles or layers failed to load. */
    _error?: unknown;
}

export interface LayerVisibilityMap {
    getLayer(id: string): unknown;
    getLayoutProperty(id: string, name: 'visibility'): unknown;
    setLayoutProperty(id: string, name: 'visibility', value: 'visible' | 'none'): void;
}

export interface ShowLayersResult {
    /** Names of overlays whose layers this run made visible. */
    shown: string[];
    /** Configured layer ids with no working overlay layer on the map. */
    missing: string[];
    /** Hide again the layers this run showed. Call in a `finally` block. */
    restore: () => void;
}

export function showLayersForDetect(
    map: LayerVisibilityMap,
    overlays: EnsurableOverlay[],
    layerIds: string[],
): ShowLayersResult {
    const shownLayers: Array<{ overlay: EnsurableOverlay; layerId: string }> = [];
    const shownNames = new Set<string>();
    const missing: string[] = [];

    for (const configId of new Set(layerIds)) {
        let found = false;
        for (const overlay of overlays) {
            // A failed overlay draws nothing; treat it as missing so an empty result is not
            // mistaken for "no value at this point".
            if (overlay._error) continue;
            for (const layer of overlay.styles) {
                if (layer.type === 'background') continue;
                if (!layerMatches(layer.id, configId) || !map.getLayer(layer.id)) continue;
                found = true;
                if (map.getLayoutProperty(layer.id, 'visibility') === 'none') {
                    map.setLayoutProperty(layer.id, 'visibility', 'visible');
                    shownLayers.push({ overlay, layerId: layer.id });
                    shownNames.add(overlay.name);
                }
            }
        }
        if (!found) missing.push(configId);
    }

    return {
        shown: [...shownNames],
        missing,
        restore: () => {
            for (const { overlay, layerId } of shownLayers) {
                // The user may have turned the overlay on during detect; leave it on then.
                if (overlay.visible || !map.getLayer(layerId)) continue;
                map.setLayoutProperty(layerId, 'visibility', 'none');
            }
        },
    };
}
