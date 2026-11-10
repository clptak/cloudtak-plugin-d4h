// Load the incident-manager org chart (Organization tab) for roster submit.
//
// TAK Server 5.9+: Mission Property `s.assignments-org-chart` on the
// management DataSync (`{name} - MGMT`).
// Legacy: `assignments_org_chart` in mission_schema.json on the same DataSync,
// for incidents not yet moved to Mission Properties.

import {
    collectD4hMemberIds,
    orgChartFromSchemaValue,
    orgChartHasContent,
    type OrgChartTree,
} from './org-chart-members.ts';
import { missionTokenForGuid, resolveMgmtMission } from './mgmt-mission.ts';
import {
    getMissionPropertyJson,
    ORG_CHART_KEY,
    usesMissionProperties,
} from './mission-properties.ts';
import { loadLegacySchemaFile } from './legacy-schema.ts';

export type OrgChartEmptyReason = 'no-data' | 'empty-chart' | 'no-member-ids';

export interface LoadedOrgChart {
    tree: OrgChartTree;
    missionGuid: string;
    missionName: string;
    /** Where the chart came from: the property key, or the legacy file name. */
    source?: string;
    emptyReason?: OrgChartEmptyReason;
}

export async function loadOrgChartFromMission(missionGuid: string): Promise<LoadedOrgChart> {
    const mgmt = await resolveMgmtMission(missionGuid);
    const token = mgmt.token || await missionTokenForGuid(mgmt.guid);

    let tree: OrgChartTree | null = null;
    let source: string | undefined;

    if (await usesMissionProperties(mgmt.guid, token)) {
        const value = await getMissionPropertyJson<unknown>(mgmt.guid, ORG_CHART_KEY, token);
        tree = orgChartFromSchemaValue(value);
        source = ORG_CHART_KEY;
    } else {
        const legacy = await loadLegacySchemaFile({ ...mgmt, token });
        if (legacy) {
            tree = orgChartFromSchemaValue(legacy.schema.assignments_org_chart);
            source = legacy.fileName;
        }
    }

    let emptyReason: OrgChartEmptyReason | undefined;
    if (!tree) emptyReason = 'no-data';
    else if (!orgChartHasContent(tree)) emptyReason = 'empty-chart';
    else if (!collectD4hMemberIds(tree).length) emptyReason = 'no-member-ids';

    return {
        tree: tree ?? {},
        missionGuid: mgmt.guid,
        missionName: mgmt.name,
        source,
        emptyReason,
    };
}
