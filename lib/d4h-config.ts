// Typed wrapper around @capacitor/preferences for the D4H plugin's local config.
//
// Why Preferences and not db.kv / localStorage:
//   - Per plan §4: token/base URL/context belong in Preferences (not the shared kv
//     blob) so credentials don't sit in the cross-plugin roster cache.
//   - On native, Preferences maps to iOS Keychain / Android EncryptedSharedPreferences.
//     On web/PWA it falls back to localStorage, which is NOT encrypted — same
//     posture as the somewear / dispatcher plugins' creds. If you ever need to
//     harden web-side token storage, the right move is a server-proxy route, not
//     a heavier browser store.
//
// Single key, single JSON blob — keeps loads atomic.

import { Preferences } from '@capacitor/preferences';
import { deploymentDefaults } from './deploymentDefaults.ts';

export const CONFIG_KEY = 'd4h-config-v1';

export type D4HRegion = 'us' | 'eu' | 'ap' | 'ca';
export type D4HContext = 'team' | 'organization';

const REGIONS: readonly D4HRegion[] = ['us', 'eu', 'ap', 'ca'];
const CONTEXTS: readonly D4HContext[] = ['team', 'organization'];

export interface D4HConfig {
    region:      D4HRegion;
    baseUrl?:    string;    // optional override; defaults to regionBaseUrl(region)
    context:     D4HContext;
    contextId:   number;    // numeric in source (e.g. 12345)
    token:       string;    // D4H access token (Bearer)
}

/** Form-ready config. contextId is null until a deployment file or a save provides one. */
export interface D4HConfigDraft {
    region:    D4HRegion;
    baseUrl:   string;
    context:   D4HContext;
    contextId: number | null;
    token:     string;
}

const DEFAULT_DRAFT: D4HConfigDraft = {
    region:    'us',
    baseUrl:   '',
    context:   'team',
    contextId: null,
    token:     '',
};

export function regionBaseUrl(region: D4HRegion): string {
    return `https://api.team-manager.${region}.d4h.com`;
}

/** Effective base URL — honors override, falls back to region default. */
export function effectiveBaseUrl(config: Pick<D4HConfig, 'region' | 'baseUrl'>): string {
    const override = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
    return override || regionBaseUrl(config.region);
}

/**
 * Hard-coded defaults, then config.local.ts, then this browser's Preferences.
 * A blank saved string falls back to the deployment file. A non-blank saved
 * string wins. The token only ever comes from Preferences.
 */
export function applyDeploymentDefaults(stored: Partial<D4HConfig> | null): D4HConfigDraft {
    const deployed = deploymentDefaults();
    const draft: D4HConfigDraft = {
        ...DEFAULT_DRAFT,
        region:    asRegion(deployed.region) ?? DEFAULT_DRAFT.region,
        baseUrl:   trimmed(deployed.baseUrl),
        context:   asContext(deployed.context) ?? DEFAULT_DRAFT.context,
        contextId: positiveId(deployed.contextId),
    };

    if (!stored) return draft;

    draft.token = trimmed(stored.token);

    const region = asRegion(stored.region);
    if (region) draft.region = region;

    const baseFromUser = trimmed(stored.baseUrl);
    if (baseFromUser) draft.baseUrl = baseFromUser;

    const context = asContext(stored.context);
    if (context) draft.context = context;

    const savedId = positiveId(stored.contextId);
    if (savedId != null) draft.contextId = savedId;

    return draft;
}

export async function loadConfigDraft(): Promise<D4HConfigDraft> {
    return applyDeploymentDefaults(await readStored());
}

export async function loadConfig(): Promise<D4HConfig | null> {
    const draft = await loadConfigDraft();
    if (draft.contextId == null || draft.contextId <= 0 || draft.token.length === 0) return null;
    return {
        region:    draft.region,
        baseUrl:   draft.baseUrl.trim() || undefined,
        context:   draft.context,
        contextId: draft.contextId,
        token:     draft.token,
    };
}

export async function saveConfig(config: D4HConfig): Promise<void> {
    await Preferences.set({ key: CONFIG_KEY, value: JSON.stringify(configForStorage(config)) });
}

export async function clearConfig(): Promise<void> {
    try { await Preferences.remove({ key: CONFIG_KEY }); } catch { /* ignore */ }
}

interface StoredConfig {
    region:    string;
    baseUrl:   string;
    context:   string;
    contextId?: number;
    token:     string;
}

function configForStorage(config: D4HConfig): StoredConfig {
    const deployed = deploymentDefaults();
    const stored: StoredConfig = {
        region:  sharedStringForStorage(config.region, asRegion(deployed.region) ?? ''),
        baseUrl: sharedStringForStorage(config.baseUrl ?? '', trimmed(deployed.baseUrl)),
        context: sharedStringForStorage(config.context, asContext(deployed.context) ?? ''),
        token:   config.token,
    };

    const deployedId = positiveId(deployed.contextId);
    if (deployedId == null || config.contextId !== deployedId) {
        stored.contextId = config.contextId;
    }

    return stored;
}

async function readStored(): Promise<Partial<D4HConfig> | null> {
    try {
        const { value } = await Preferences.get({ key: CONFIG_KEY });
        if (!value) return null;
        const parsed: unknown = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        return parsed as Partial<D4HConfig>;
    } catch {
        return null;
    }
}

function sharedStringForStorage(value: string, deployed: string): string {
    const trimmedValue = value.trim();
    if (deployed.length > 0 && trimmedValue === deployed) return '';
    return trimmedValue;
}

function trimmed(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRegion(value: unknown): D4HRegion | null {
    const region = trimmed(value);
    return (REGIONS as readonly string[]).includes(region) ? region as D4HRegion : null;
}

function asContext(value: unknown): D4HContext | null {
    const context = trimmed(value);
    return (CONTEXTS as readonly string[]).includes(context) ? context as D4HContext : null;
}

function positiveId(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return value;
}
