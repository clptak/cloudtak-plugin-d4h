/**
 * Desktop free-float controller for D4H (no bottom status-bar chips).
 *
 * Uses the float store directly so we can supply a custom FloatingPane shell —
 * api.float.add always wraps FloatingGeneric.
 */
import { markRaw } from 'vue';
import type { Component } from 'vue';
import type { PluginAPI } from '../../../plugin.ts';
import { useFloatStore } from '../../../src/stores/float.ts';
import { isPopoutOpen, focusPopout } from './popout.ts';

export const PANE_UID = 'd4h';

export type PaneGeometry = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export const DEFAULT_GEOMETRY: PaneGeometry = {
    width: 980,
    height: 640,
    x: 80,
    y: 60,
};

let api: PluginAPI | null = null;
let shellComponent: Component | null = null;
let savedGeometry: PaneGeometry | null = null;
let hidden = false;

export function bindFloatPane(opts: {
    api: PluginAPI;
    shell: Component;
}): void {
    api = opts.api;
    shellComponent = opts.shell;
}

function requireApi(): PluginAPI {
    if (!api) throw new Error('floatPane not bound');
    return api;
}

function readGeometry(): PaneGeometry {
    const pluginApi = requireApi();
    const pane = useFloatStore(pluginApi.pinia).panes.get(PANE_UID);
    if (!pane) return { ...(savedGeometry ?? DEFAULT_GEOMETRY) };
    return {
        x: pane.x,
        y: pane.y,
        width: pane.width,
        height: pane.height,
    };
}

function showFloat(geometry: PaneGeometry): void {
    const pluginApi = requireApi();
    if (!shellComponent) {
        throw new Error('floatPane shell not configured');
    }
    useFloatStore(pluginApi.pinia).add({
        uid: PANE_UID,
        name: 'D4H',
        component: markRaw(shellComponent),
        width: geometry.width,
        height: geometry.height,
        x: geometry.x,
        y: geometry.y,
    });
}

/**
 * Open the desktop float, or restore it if currently hidden (e.g. after pop-out).
 * No-op if the float is already visible.
 * When the popout window is open, focus it instead.
 */
export function openDesktopPane(): void {
    const pluginApi = requireApi();
    if (isPopoutOpen()) {
        focusPopout();
        return;
    }
    if (hidden) {
        hidden = false;
        if (!pluginApi.float.has(PANE_UID)) {
            showFloat(savedGeometry ?? DEFAULT_GEOMETRY);
        }
        return;
    }
    if (pluginApi.float.has(PANE_UID)) return;
    showFloat(savedGeometry ?? DEFAULT_GEOMETRY);
}

/** Hide the float and remember geometry (used when pushing UI to the pop-out). */
export function hideDesktopPane(): void {
    const pluginApi = requireApi();
    if (!pluginApi.float.has(PANE_UID) || hidden) return;

    savedGeometry = readGeometry();
    pluginApi.float.remove(PANE_UID);
    hidden = true;
}

export function cleanupFloatPane(): void {
    hidden = false;
    if (api?.float.has(PANE_UID)) {
        api.float.remove(PANE_UID);
    }
}
