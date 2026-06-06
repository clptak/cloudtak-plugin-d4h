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

export const CONFIG_KEY = 'd4h-config-v1';

export type D4HRegion = 'us' | 'eu' | 'ap' | 'ca';
export type D4HContext = 'team' | 'organization';

export interface D4HConfig {
    region:      D4HRegion;
    baseUrl?:    string;    // optional override; defaults to regionBaseUrl(region)
    context:     D4HContext;
    contextId:   number;    // numeric in source (e.g. 12345)
    token:       string;    // D4H access token (Bearer)
}

export function regionBaseUrl(region: D4HRegion): string {
    return `https://api.team-manager.${region}.d4h.com`;
}

/** Effective base URL — honors override, falls back to region default. */
export function effectiveBaseUrl(config: Pick<D4HConfig, 'region' | 'baseUrl'>): string {
    const override = (config.baseUrl ?? '').trim().replace(/\/+$/, '');
    return override || regionBaseUrl(config.region);
}

export async function loadConfig(): Promise<D4HConfig | null> {
    try {
        const { value } = await Preferences.get({ key: CONFIG_KEY });
        if (!value) return null;
        const parsed = JSON.parse(value) as Partial<D4HConfig>;
        if (!isCompleteConfig(parsed)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export async function saveConfig(config: D4HConfig): Promise<void> {
    await Preferences.set({ key: CONFIG_KEY, value: JSON.stringify(config) });
}

export async function clearConfig(): Promise<void> {
    try { await Preferences.remove({ key: CONFIG_KEY }); } catch { /* ignore */ }
}

function isCompleteConfig(c: Partial<D4HConfig>): c is D4HConfig {
    return typeof c.region    === 'string'
        && typeof c.context   === 'string'
        && typeof c.contextId === 'number' && Number.isFinite(c.contextId)
        && typeof c.token     === 'string' && c.token.length > 0;
}
