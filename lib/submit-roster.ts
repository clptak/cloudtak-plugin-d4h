import {
    listActivityAttendance,
    createActivityAttendance,
    updateActivityAttendance,
    type D4HAttendanceStatus,
} from './d4h-client.ts';
import type { D4HConfig } from './d4h-config.ts';
import { formatD4hWriteError, isPublishedActivityError } from './d4h-errors.ts';

export interface RosterSubmitMemberResult {
    memberId: number;
    action: 'created' | 'updated' | 'skipped';
    attendanceId?: number;
    error?: string;
}

export interface RosterSubmitResult {
    ok: boolean;
    results: RosterSubmitMemberResult[];
    error?: string;
}

function defaultEndsAt(startsAt: string): string {
    const startMs = Date.parse(startsAt);
    if (Number.isNaN(startMs)) return new Date().toISOString();
    return new Date(startMs + 8 * 60 * 60 * 1000).toISOString();
}

/**
 * Create or update D4H attendance for each org-chart member on the selected activity.
 * Existing rows are PATCHed (Update an activity attendance); missing rows are POSTed.
 */
export async function submitRosterToActivity(
    config: D4HConfig,
    opts: {
        activityId: number;
        memberIds: number[];
        startsAt: string;
        endsAt?: string;
        status?: D4HAttendanceStatus;
    },
): Promise<RosterSubmitResult> {
    if (config.context !== 'team') {
        return {
            ok: false,
            results: [],
            error: 'Attendance writes require a team context (not organization).',
        };
    }

    const memberIds = [...new Set(opts.memberIds.filter((id) => Number.isFinite(id) && id > 0))];
    if (!memberIds.length) {
        return { ok: false, results: [], error: 'No D4H members found on the org chart.' };
    }

    const startsAt = opts.startsAt;
    const endsAt = opts.endsAt?.trim() || defaultEndsAt(startsAt);
    const status: D4HAttendanceStatus = opts.status ?? 'ATTENDING';

    let existing;
    try {
        existing = await listActivityAttendance(config, opts.activityId);
    } catch (e) {
        return {
            ok: false,
            results: [],
            error: `Failed to load existing attendance: ${(e as Error).message}`,
        };
    }

    const byMemberId = new Map<number, number>();
    for (const row of existing) {
        if (row.memberId != null && row.id != null) byMemberId.set(row.memberId, row.id);
    }

    const results: RosterSubmitMemberResult[] = [];

    for (const memberId of memberIds) {
        const attendanceId = byMemberId.get(memberId);
        try {
            if (attendanceId != null) {
                await updateActivityAttendance(config, attendanceId, { status, startsAt, endsAt });
                results.push({ memberId, action: 'updated', attendanceId });
            } else {
                const created = await createActivityAttendance(config, {
                    memberId,
                    activityId: opts.activityId,
                    status,
                    startsAt,
                    endsAt,
                });
                const newId = typeof created.id === 'number' ? created.id : Number(created.id);
                results.push({
                    memberId,
                    action: 'created',
                    attendanceId: Number.isFinite(newId) ? newId : undefined,
                });
            }
        } catch (e) {
            results.push({ memberId, action: 'skipped', error: formatD4hWriteError(e) });
            if (isPublishedActivityError(e)) break;
        }
    }

    const failed = results.filter((r) => r.error);
    const publishedBlock = failed.some((r) => r.error?.includes('published in D4H'));
    return {
        ok: failed.length === 0,
        results,
        error: publishedBlock
            ? 'Cannot submit roster — this incident is published in D4H.'
            : failed.length
                ? `${failed.length} member(s) failed — see details below.`
                : undefined,
    };
}
