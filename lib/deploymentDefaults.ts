import type { D4HConfig } from './d4h-config.ts';
import type { OverlayFieldMapping } from './overlay-field-map.ts';

/** Shared settings from config.local.ts. Omit the personal access token. */
export type DeploymentSettings = Partial<Omit<D4HConfig, 'token'>>;

interface DeploymentModule {
    deploymentDefaults?: DeploymentSettings;
    overlayFieldMap?: OverlayFieldMapping[];
}

// Vite only compiles a literal import.meta.glob call, so it stays here.
// With no config.local.ts the glob is empty and everything falls back to defaults.
function deploymentModules(): DeploymentModule[] {
    return Object.values(import.meta.glob<DeploymentModule>('../config.local.ts', {
        eager: true,
    }));
}

/** Overlay → custom-field rows for Submit Incident auto-fill, from config.local.ts. */
export function deploymentOverlayFieldMap(): OverlayFieldMapping[] {
    for (const mod of deploymentModules()) {
        if (Array.isArray(mod?.overlayFieldMap)) return mod.overlayFieldMap;
    }
    return [];
}

export function deploymentDefaults(): DeploymentSettings {
    for (const mod of deploymentModules()) {
        const defaults = mod?.deploymentDefaults;
        if (!defaults || typeof defaults !== 'object') continue;

        const rest = { ...defaults } as DeploymentSettings & { token?: string };
        delete rest.token;
        return rest;
    }

    return {};
}

export function hasDeploymentDefaults(): boolean {
    return Object.values(deploymentDefaults()).some((value) => {
        if (typeof value === 'string') return value.trim().length > 0;
        if (typeof value === 'number') return Number.isFinite(value) && value > 0;
        return value !== undefined && value !== null;
    });
}
