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
//   1. The raw overlay value is first run through `valueMap` (if present) to translate the overlay's
//      label into the exact D4H value/option label. Keys match case-insensitively + whitespace-
//      normalized; an unmapped value passes through unchanged.
//   2. SINGLE_CHOICE / MULTIPLE_CHOICE fields: the (translated) value is matched (case-insensitive,
//      whitespace-normalized) against the field's option labels; the matching option id is selected.
//      TEXT / TEXT_AREA / NUMBER / DATE / DATETIME / TIME fields: the (translated) value is written as-is.
//
// Note: auto-detect can only read overlays that are toggled ON. The "Detect" button recenters the
// map on the point first so the overlay tiles are rendered there before querying.

export interface OverlayFieldMapping {
    /** D4H incident custom-field id to fill. */
    customFieldId: number;
    /**
     * Overlay layer id (from "Inspect overlays at point"). Use the STABLE part shown in green, e.g.
     * "136-poly" — the leading number ("1202-") is the overlay's runtime id and CHANGES on restart.
     * A full id like "1202-136-poly" also works; the leading numeric prefix is ignored when matching.
     */
    overlayLayerId: string;
    /** Property key on that overlay's features whose value to use, e.g. "DISTRICT_NAME". */
    attribute: string;
    /**
     * Optional translation from the overlay's attribute value → the D4H value/option label.
     * Use when the overlay's wording differs from D4H's, e.g.
     *   { 'Red Rock Ranger District': 'USFS COCONINO-RED ROCK RANGER DISTRICT' }
     * Keys are matched case-insensitively and whitespace-normalized. Unlisted values pass through.
     */
    valueMap?: Record<string, string>;
    /** Optional human note — ignored by code. */
    note?: string;
}

export const OVERLAY_FIELD_MAP: OverlayFieldMapping[] = [
    // --- Examples (commented). Replace with real ids/keys discovered via "Inspect overlays". ---
    // { customFieldId: 1001, overlayLayerId: '57-fill', attribute: 'DISTRICT_NAME', note: 'BOS District' },
    // { customFieldId: 1002, overlayLayerId: '61-fill', attribute: 'LMU_NAME',      note: 'Land Mgmt District' },
    // { customFieldId: 1003, overlayLayerId: '63-fill', attribute: 'WILDERNESS',    note: 'Wilderness Incursion' },
    {
        customFieldId: 8032, // TODO: replace with the real D4H "Land Management" field id (#id shown in the tab)
        overlayLayerId: '136-poly',
        attribute: 'districtorgcode',
        note: 'Land Management District',
        valueMap: {
            // overlay value (districtname)        : D4H option label (must match exactly after normalize)
            '030406': 'USFS COCONINO-RED ROCK RANGER DISTRICT',
            '030701': 'USFS KAIBAB-WILLIAMS RANGER DISTRICT',
            '030704': 'USFS KAIBAB-TUSAYAN RANGER DISTRICT',
            '030703': 'USFS KAIBAB-NORTH KAIBAB RANGER DISTRICT',
            '030408': 'USFS COCONINO-FLAGSTAFF RANGER DISTRICT',
            '030407': 'USFS COCONINO-MOGOLLON RIM RANGER DISTRICT',
            '030102': 'USFS A-S - BLACK MESA RANGER DISTRICT',
            '030905': 'USFS PRESCOTT - VERDE RANGER DISTRICT',
            '030901': 'USFS PRESCOTT - CHINO VALLEY RANGER DISTRICT',
            // add the rest of your districts here, e.g.:
            // 'Mogollon Rim Ranger District': 'USFS COCONINO-MOGOLLON RIM RANGER DISTRICT',
        },
    },
    {
        customFieldId: 1485,
        overlayLayerId: 'landowner-poly',
        attribute: 'OWNERORMANAGINGAGENCY',
        note: 'Land Owner or Managing Agency',
        valueMap: {
            // overlay value (Land Owner or Managing Agency)        : D4H option label (must match exactly after normalize)
            'Apache-Sitgreaves National Forests': 'USFS',
            'Coconino National Forest': 'USFS',
            'Kaibab National Forest': 'USFS',
            'Grand Canyon National Park': 'NPS',
            'Sunset Crater National Monument': 'NPS',
            'Walnut Canyon National Monument': 'NPS',
            'Vermilion Cliffs National Monument': 'BLM',
            'Bureau of Land Management': 'BLM',
            'Baaj Nwaavjo Itah Kukveni National Monument': 'BLM',
            'Glen Canyon National Recreation Area': 'NPS',
            'City of Page': 'MUNICIPAL',
            'City of Flagstaff': 'MUNICIPAL',
            'City of Williams': 'MUNICIPAL',
            'City of Sedona': 'MUNICIPAL',
            'Navajo Nation': 'TRIBAL',
            'Hopi Tribal Land': 'TRIBAL',
            'Hualapai Tribal Land': 'TRIBAL',
            'Havasupai Tribal Land': 'TRIBAL',
            'Private': 'PRIVATE',
            'State Trust': 'STATE',
        },
    },
    {
        customFieldId: 8033, // TODO: replace with the real D4H "Wilderness" field id (#id shown in the tab)
        overlayLayerId: '38-polyline1',
        attribute: 'OBJECTID',
        note: 'Supervisor District',
        valueMap: {
            '1': 'DISTRICT 1',
        },
    },
    {
        customFieldId: 8033, // TODO: replace with the real D4H "Wilderness" field id (#id shown in the tab)
        overlayLayerId: '38-polyline2',
        attribute: 'OBJECTID',
        note: 'Supervisor District',
        valueMap: {
            '2': 'DISTRICT 2',
        },
    },
    {
        customFieldId: 8033, // TODO: replace with the real D4H "Wilderness" field id (#id shown in the tab)
        overlayLayerId: '38-polyline3',
        attribute: 'OBJECTID',
        note: 'Supervisor District',
        valueMap: {
            '3': 'DISTRICT 3',
        },
    },
    {
        customFieldId: 8033, // TODO: replace with the real D4H "Wilderness" field id (#id shown in the tab)
        overlayLayerId: '38-polyline4',
        attribute: 'OBJECTID',
        note: 'Supervisor District',
        valueMap: {
            '4': 'DISTRICT 4',        },
    },
    {
        customFieldId: 8033, // TODO: replace with the real D4H "Wilderness" field id (#id shown in the tab)
        overlayLayerId: '38-polyline5',
        attribute: 'OBJECTID',
        note: 'Supervisor District',
        valueMap: {
            // overlay value (OBJECTID)        : D4H option label (must match exactly after normalize)
            '5': 'DISTRICT 5',
        },
    },
    {
        customFieldId: 1483, // WILDERNESS AREA NAME (TEXT field — value passes through as-is)
        overlayLayerId: 'wilderness-poly',
        attribute: 'NAME', // this layer uses `wildernessname`; the lowercase `wilderness-poly` uses `NAME`
        note: 'Wilderness Area Name',
    },

    // Wilderness — the D4H field is TEXT, so NO valueMap is needed: the raw overlay
    // attribute value is written into the field as-is. Fill in the three values and uncomment.
    // {
    //     customFieldId: 0,                 // <- the Wilderness D4H TEXT field's #id (shown in the tab)
    //     overlayLayerId: 'REPLACE-poly',   // <- from "Inspect overlays at point"
    //     attribute: 'REPLACE',             // <- the property key holding the wilderness name
    //     note: 'Wilderness Incursion',
    // },
];
