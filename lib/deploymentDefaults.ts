import type { D4HConfig } from './d4h-config.ts';

/** Shared settings from config.local.ts. Omit the personal access token. */
export type DeploymentSettings = Partial<Omit<D4HConfig, 'token'>>;

interface DeploymentModule {
    deploymentDefaults?: DeploymentSettings;
}

export function deploymentDefaults(): DeploymentSettings {
    const modules = import.meta.glob<DeploymentModule>('../config.local.ts', {
        eager: true,
    });

    for (const mod of Object.values(modules)) {
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
