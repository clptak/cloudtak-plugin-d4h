// Static overlay → incident-custom-field mapping (Paul-authored).
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
//   4. Add a row below.
//
// Matching behavior at detect time:
//   - SINGLE_CHOICE / MULTIPLE_CHOICE fields: the detected value is matched (case-insensitive,
//     whitespace-normalized) against the field's option labels; the matching option id is selected.
//   - TEXT / TEXT_AREA / NUMBER / DATE / DATETIME / TIME fields: the detected value is written as-is.
//
// Note: auto-detect can only read overlays that are toggled ON. The "Detect" button recenters the
// map on the point first so the overlay tiles are rendered there before querying.

export interface OverlayFieldMapping {
    /** D4H incident custom-field id to fill. */
    customFieldId: number;
    /** Maplibre layer id of the clickable overlay (from "Inspect overlays at point"), e.g. "57-fill". */
    overlayLayerId: string;
    /** Property key on that overlay's features whose value to use, e.g. "DISTRICT_NAME". */
    attribute: string;
    /** Optional human note — ignored by code. */
    note?: string;
}

export const OVERLAY_FIELD_MAP: OverlayFieldMapping[] = [
    // --- Examples (commented). Replace with real ids/keys discovered via "Inspect overlays". ---
    // { customFieldId: 1001, overlayLayerId: '57-fill', attribute: 'DISTRICT_NAME', note: 'BOS District' },
    // { customFieldId: 1002, overlayLayerId: '61-fill', attribute: 'LMU_NAME',      note: 'Land Mgmt District' },
    // { customFieldId: 1003, overlayLayerId: '63-fill', attribute: 'WILDERNESS',    note: 'Wilderness Incursion' },
];
