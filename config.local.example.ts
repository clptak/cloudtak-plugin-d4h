import type { DeploymentSettings } from './lib/deploymentDefaults.ts';

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
