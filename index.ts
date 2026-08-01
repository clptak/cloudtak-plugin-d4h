import type { App } from 'vue';
import { defineAsyncComponent, defineComponent, h, markRaw, onMounted } from 'vue';
import type { PluginAPI, PluginInstance, MenuItemConfig } from '../../plugin.ts';
import { useAppStore } from '../../src/stores/app.ts';
import D4HIcon from './lib/D4HIcon.vue';
import HomeView from './components/HomeView.vue';
import {
    bindFloatPane,
    cleanupFloatPane,
    openDesktopPane,
} from './lib/floatPane.ts';
import { bindPopout, closePopout } from './lib/popout.ts';

const MENU_KEY   = 'plugin-d4h';
const ROUTE_NAME = 'home-menu-d4h';

const D4HFloatShell = defineAsyncComponent(
    () => import('./components/D4HFloatShell.vue')
);

export default class D4HPlugin implements PluginInstance {
    api: PluginAPI;

    constructor(api: PluginAPI) {
        this.api = api;
    }

    static async install(app: App, api: PluginAPI): Promise<D4HPlugin> {
        void app;

        bindPopout(api);
        bindFloatPane({
            api,
            shell: D4HFloatShell as unknown as HostFloatComponent,
        });

        api.routes.add(
            {
                path: 'd4h',
                name: ROUTE_NAME,
                component: defineComponent({
                    name: 'D4HEntry',
                    setup() {
                        const appStore = useAppStore(api.pinia);
                        onMounted(() => {
                            if (!appStore.isMobileDetected) {
                                openDesktopPane();
                                void api.router.replace({ name: 'home' });
                            }
                        });
                        return () => {
                            if (appStore.isMobileDetected) {
                                return h(HomeView);
                            }
                            return null;
                        };
                    },
                }),
            },
            'home-menu'
        );
        return new D4HPlugin(api);
    }

    async enable(): Promise<void> {
        const api = this.api;

        bindPopout(api);
        bindFloatPane({
            api,
            shell: D4HFloatShell as unknown as HostFloatComponent,
        });

        this.api.menu.add({
            key:         MENU_KEY,
            label:       'D4H',
            route:       ROUTE_NAME,
            tooltip:     'D4H Team Manager roster',
            description: 'Personnel, equipment, external resources, and incidents from D4H',
            icon:        markRaw(D4HIcon) as unknown as MenuItemIconType,
        } as MenuItemConfig);
    }

    async disable(): Promise<void> {
        // Only remove the menu item. CloudTAK calls disable() on every page load
        // before enable() (the isLoaded watcher fires immediately with isLoaded=false),
        // so removing the route here makes the subsequent enable() menu.add fail with
        // "route not found". Route is registered once in install() and left in place.
        try { this.api.menu.remove(MENU_KEY); } catch { /* ignore */ }
        closePopout();
        cleanupFloatPane();
    }
}

type MenuItemIconType = NonNullable<Parameters<PluginAPI['menu']['add']>[0]['icon']>;
type HostFloatComponent = Parameters<PluginAPI['float']['add']>[0]['component'];
