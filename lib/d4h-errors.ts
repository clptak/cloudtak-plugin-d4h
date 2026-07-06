/** Turn D4H write errors (from writeJson) into operator-friendly text. */

interface D4hErrorBody {
    title?:  string;
    detail?: string;
    status?: number;
}

function parseErrorBody(message: string): D4hErrorBody | null {
    const dash = message.indexOf(' — ');
    if (dash < 0) return null;
    const tail = message.slice(dash + 3).trim();
    if (!tail.startsWith('{')) return null;
    try {
        return JSON.parse(tail) as D4hErrorBody;
    } catch {
        return null;
    }
}

export function d4hErrorStatus(err: unknown): number | undefined {
    const status = (err as Error & { status?: number }).status;
    return typeof status === 'number' ? status : undefined;
}

export function isPublishedActivityError(err: unknown): boolean {
    if (d4hErrorStatus(err) !== 409) return false;
    const body = parseErrorBody((err as Error).message ?? '');
    const detail = (body?.detail ?? '').toLowerCase();
    return detail.includes('published');
}

export function formatD4hWriteError(err: unknown): string {
    const message = (err as Error).message ?? String(err);
    const status = d4hErrorStatus(err);
    const body = parseErrorBody(message);

    if (status === 409 && body?.detail?.toLowerCase().includes('published')) {
        return 'This incident is published in D4H — attendance cannot be added or changed after publish. '
            + 'Submit the roster before publishing the incident, or unpublish it in D4H Team Manager first.';
    }

    if (body?.detail) return body.detail;
    if (body?.title && status) return `${body.title} (HTTP ${status})`;
    return message;
}
