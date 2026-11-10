import type { DeploymentSettings } from './lib/deploymentDefaults.ts';
import type { OverlayFieldMapping } from './lib/overlay-field-map.ts';

/**
 * Copy to config.local.ts (gitignored), fill in this deployment, then restart
 * or rebuild CloudTAK's app/.
 *
 * These values are compiled into the web bundle. Anyone who can load CloudTAK
 * can read them. Do not put a D4H token here — each person uses their own
 * personal access token.
 *
 * contextId 0 means unset.
 */
export const deploymentDefaults: DeploymentSettings = {
    region: 'us',
    baseUrl: '',
    context: 'team',
    contextId: 0,
};

/**
 * Optional: Submit Incident overlay auto-fill. Each row reads `attribute` from
 * overlay layer `overlayLayerId` at the incident point and writes it into D4H
 * incident custom field `customFieldId`. Leave empty to hide the Detect button.
 *
 * Find values with Submit Incident → "Inspect overlays at point": use the
 * stable layer id shown in green (without the leading runtime number) and the
 * custom field id shown next to each field. Placeholder values below.
 *
 * Detect finds each overlay in CloudTAK's catalog from its layer id and reads its
 * tiles, so nobody has to add or turn on an overlay; the person's account only has
 * to be able to see it in the catalog. If an overlay uses CloudTAK's default style
 * (layer ids like "<number>-poly"), the catalog has no layer ids for it, so add
 * `basemapId: <catalog id>` to its rows.
 */
export const overlayFieldMap: OverlayFieldMapping[] = [
    // {
    //     customFieldId: 1001,
    //     overlayLayerId: '57-fill',
    //     attribute: 'DISTRICT_NAME',
    //     note: 'Supervisor district (SINGLE_CHOICE)',
    //     valueMap: { 'District A': 'AGENCY DISTRICT A' },
    // },
    // {
    //     customFieldId: 1002,
    //     overlayLayerId: 'wilderness-poly',
    //     attribute: 'NAME',
    //     note: 'Wilderness area name (TEXT)',
    // },
];
