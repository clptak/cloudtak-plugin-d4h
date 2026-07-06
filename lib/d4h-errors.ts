/** Turn D4H write errors (from writeJson) into operator-friendly text. */

export interface D4hWriteError extends Error {
    status?: number;
    /** Parsed JSON body from D4H (when available). */
    body?: unknown;
}

interface D4hZodIssue {
    path?:  (string | number)[];
    message?: string;
}

function parseErrorBodyFromMessage(message: string): unknown | null {
    const dash = message.indexOf(' — ');
    if (dash < 0) return null;
    const tail = message.slice(dash + 3).trim();
    if (!tail.startsWith('{')) return null;
    try {
        return JSON.parse(tail);
    } catch {
        return null;
    }
}

export function d4hErrorBody(err: unknown): unknown | null {
    const body = (err as D4hWriteError).body;
    if (body != null) return body;
    return parseErrorBodyFromMessage((err as Error).message ?? '');
}

function collectValidationMessages(value: unknown, depth = 0): string[] {
    if (depth > 8 || value == null) return [];

    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
    }

    if (Array.isArray(value)) {
        return value.flatMap((item) => collectValidationMessages(item, depth + 1));
    }

    if (typeof value !== 'object') return [];

    const o = value as Record<string, unknown>;
    const msgs: string[] = [];

    if (Array.isArray(o.issues)) {
        for (const issue of o.issues as D4hZodIssue[]) {
            const path = issue.path?.length ? issue.path.join('.') : '';
            const text = issue.message?.trim();
            if (text) msgs.push(path ? `${path}: ${text}` : text);
        }
    }

    if (typeof o.message === 'string' && o.message.trim()) {
        msgs.push(o.message.trim());
    }

    for (const key of ['detailObj', 'data', 'errors', 'validation', 'fields']) {
        if (o[key] != null) {
            msgs.push(...collectValidationMessages(o[key], depth + 1));
        }
    }

    return [...new Set(msgs)];
}

export function d4hErrorStatus(err: unknown): number | undefined {
    const status = (err as D4hWriteError).status;
    return typeof status === 'number' ? status : undefined;
}

export function isPublishedActivityError(err: unknown): boolean {
    if (d4hErrorStatus(err) !== 409) return false;
    const detail = JSON.stringify(d4hErrorBody(err) ?? '').toLowerCase();
    return detail.includes('published');
}

export function isMalformedRequestError(err: unknown): boolean {
    if (d4hErrorStatus(err) !== 400) return false;
    const detail = JSON.stringify(d4hErrorBody(err) ?? '').toLowerCase();
    return detail.includes('malformed');
}

export function formatD4hWriteError(err: unknown): string {
    const message = (err as Error).message ?? String(err);
    const status = d4hErrorStatus(err);
    const body = d4hErrorBody(err);
    const bodyObj = body && typeof body === 'object' ? body as Record<string, unknown> : null;

    if (status === 409 && JSON.stringify(body ?? '').toLowerCase().includes('published')) {
        return 'This incident is published in D4H — changes are locked after publish. '
            + 'Unpublish the incident in D4H Team Manager, or use an unpublished incident.';
    }

    const validation = body ? collectValidationMessages(body) : [];
    if (validation.length) {
        const headline = typeof bodyObj?.detail === 'string' ? bodyObj.detail : 'Request rejected by D4H';
        return `${headline}: ${validation.join('; ')}`;
    }

    if (typeof bodyObj?.detail === 'string' && bodyObj.detail.trim()) return bodyObj.detail.trim();
    if (typeof bodyObj?.title === 'string' && status) return `${bodyObj.title} (HTTP ${status})`;
    return message;
}

export function formatD4hErrorBody(err: unknown): string {
    const body = d4hErrorBody(err);
    if (body == null) return '';
    try {
        return JSON.stringify(body, null, 2);
    } catch {
        return String(body);
    }
}
