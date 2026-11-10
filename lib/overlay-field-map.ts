// Overlay → incident-custom-field mapping for Submit Incident auto-fill.
//
// The rows are deployment-specific, so they live in the gitignored config.local.ts
// (`export const overlayFieldMap`), not in this file. See config.local.example.ts.
//
// Each row tells the Submit Incident tab: "at the incident's CoT point, read property
// `attribute` from the overlay layer `overlayLayerId`, and write it into D4H incident
// custom field `customFieldId`."
//
// How to fill this in:
//   1. In the Submit Incident tab, pick the CoT point, then click "Inspect overlays at point".
//      It lists, for every clickable overlay under that point, the map layer id (e.g. "57-fill")
//      and that feature's property keys + values.
//   2. Find the property that holds the value you want (e.g. DISTRICT_NAME → "Supervisor District 3").
//   3. Find the matching D4H incident custom field's id (shown in the tab / via the API).
//   4. Add a row to `overlayFieldMap` in config.local.ts, then rebuild/restart CloudTAK's app/.
//
// Matching behavior at detect time:
//   1. The raw overlay value is first run through `valueMap` (if present) to translate the overlay's
//      label into the exact D4H value/option label. Keys match case-insensitively + whitespace-
//      normalized; an unmapped value passes through unchanged.
//   2. SINGLE_CHOICE / MULTIPLE_CHOICE fields: the (translated) value is matched (case-insensitive,
//      whitespace-normalized) against the field's option labels; the matching option id is selected.
//      TEXT / TEXT_AREA / NUMBER / DATE / DATETIME / TIME fields: the (translated) value is written as-is.
//
// Note: the overlay must be added to the user's map (Overlays menu). If it is switched off, detect
// shows its mapped layers on the map while reading and hides them again (lib/overlay-ensure.ts);
// nothing is saved to the server. Detect recenters the map on the point first so the tiles render.

import { deploymentOverlayFieldMap } from './deploymentDefaults.ts';

export interface OverlayFieldMapping {
    /** D4H incident custom-field id to fill. */
    customFieldId: number;
    /**
     * Overlay layer id (from "Inspect overlays at point"). Use the STABLE part shown in green, e.g.
     * "136-poly" — the leading number ("1202-") is the overlay's runtime id and CHANGES on restart,
     * so a full runtime id like "1202-136-poly" only works until the next restart.
     */
    overlayLayerId: string;
    /** Property key on that overlay's features whose value to use, e.g. "DISTRICT_NAME". */
    attribute: string;
    /**
     * Optional translation from the overlay's attribute value → the D4H value/option label.
     * Use when the overlay's wording differs from D4H's, e.g.
     *   { 'District A': 'AGENCY DISTRICT A' }
     * Keys are matched case-insensitively and whitespace-normalized. Unlisted values pass through.
     */
    valueMap?: Record<string, string>;
    /** Optional human note — ignored by code. */
    note?: string;
}

export const OVERLAY_FIELD_MAP: OverlayFieldMapping[] = deploymentOverlayFieldMap();
