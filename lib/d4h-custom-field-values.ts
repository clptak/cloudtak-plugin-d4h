import type { D4HCustomField } from './d4h-client.ts';

export function cfValueIsEmpty(f: D4HCustomField, v: unknown): boolean {
    if (f.type === 'MULTIPLE_CHOICE') return !Array.isArray(v) || v.length === 0;
    if (f.type === 'SINGLE_CHOICE') return v == null || v === '';
    return String(v ?? '').trim() === '';
}

function localInputToUTC(v: string): string | null {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeDateValue(v: string): string | null {
    const trimmed = v.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
}

function normalizeTimeValue(v: string): string | null {
    const trimmed = v.trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00`;
    return null;
}

/** Build POST `customFieldValues` for D4H (Incident, PersonInvolved, …). */
export function buildD4hCustomFieldValues(
    fields: D4HCustomField[],
    values: Record<number, unknown>,
): Array<{ id: number; value: number[] | string }> {
    const out: Array<{ id: number; value: number[] | string }> = [];

    for (const f of fields) {
        const v = values[f.id];
        if (cfValueIsEmpty(f, v)) continue;

        if (f.type === 'MULTIPLE_CHOICE') {
            const ids = (v as unknown[])
                .map((x) => Number(x))
                .filter((n) => Number.isFinite(n) && n > 0);
            if (!ids.length) continue;
            out.push({ id: f.id, value: ids });
            continue;
        }

        if (f.type === 'SINGLE_CHOICE') {
            const choiceId = Number(v);
            if (!Number.isFinite(choiceId) || choiceId <= 0) continue;
            const valid = f.options.some((o) => o.id === choiceId);
            if (!valid) continue;
            out.push({ id: f.id, value: [choiceId] });
            continue;
        }

        if (f.type === 'DATETIME') {
            const iso = localInputToUTC(String(v));
            if (iso) out.push({ id: f.id, value: iso });
            continue;
        }

        if (f.type === 'DATE') {
            const date = normalizeDateValue(String(v));
            if (date) out.push({ id: f.id, value: date });
            continue;
        }

        if (f.type === 'TIME') {
            const time = normalizeTimeValue(String(v));
            if (time) out.push({ id: f.id, value: time });
            continue;
        }

        if (f.type === 'NUMBER') {
            const num = String(v).trim();
            if (num) out.push({ id: f.id, value: num });
            continue;
        }

        const text = String(v).trim();
        if (text) out.push({ id: f.id, value: text });
    }

    return out;
}

/** Mandatory fields with UI values that did not serialize into the POST payload (bad format/choice). */
export function mandatoryCustomFieldsNotBuilt(
    fields: D4HCustomField[],
    values: Record<number, unknown>,
    built: Array<{ id: number; value: number[] | string }>,
): string[] {
    const builtIds = new Set(built.map((b) => b.id));
    return fields
        .filter((f) => f.mandatory && !cfValueIsEmpty(f, values[f.id]) && !builtIds.has(f.id))
        .map((f) => f.title);
}
