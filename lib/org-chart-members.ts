// Extract D4H member ids from the incident-manager org chart tree
// (`assignments_org_chart` in mission_schema.json).

export interface OrgChartNodeSelf {
    type?: string;
    d4hMemberId?: number;
    d4hMemberIds?: number[];
}

export interface OrgChartTree {
    self?: OrgChartNodeSelf;
    children?: OrgChartTree[];
}

function pushMemberId(ids: Set<number>, value: unknown): void {
    const n = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(n) && n > 0) ids.add(n);
}

function collectFromSelf(self: OrgChartNodeSelf | undefined, ids: Set<number>): void {
    if (!self) return;
    pushMemberId(ids, self.d4hMemberId);
    if (Array.isArray(self.d4hMemberIds)) {
        for (const id of self.d4hMemberIds) pushMemberId(ids, id);
    }
}

/** Walk the org chart and return unique D4H member ids (order preserved). */
export function collectD4hMemberIds(tree: OrgChartTree | null | undefined): number[] {
    const ids = new Set<number>();

    const walk = (node: OrgChartTree | null | undefined): void => {
        if (!node) return;
        collectFromSelf(node.self, ids);
        for (const child of node.children ?? []) walk(child);
    };

    walk(tree);
    return [...ids];
}

export function orgChartFromSchemaValue(value: unknown): OrgChartTree {
    if (!value || typeof value !== 'object') return {};
    const parsed = value as OrgChartTree;
    return {
        self: parsed.self,
        children: Array.isArray(parsed.children) ? parsed.children : [],
    };
}

export function orgChartHasMembers(tree: OrgChartTree | null | undefined): boolean {
    return collectD4hMemberIds(tree).length > 0;
}
