interface ImportMeta {
    glob<M>(pattern: string, options: { eager: true }): Record<string, M>;
}

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<object, object, unknown>;
    export default component;
}

declare module '*.svg' {
    const content: string;
    export default content;
}
