// HTTP transport for D4H API calls.
//
// On localhost CloudTAK disables CSP, so direct browser → D4H fetch works when CORS
// allows it. On a real deployment (VPS, FQDN) nginx sets connect-src 'self', which
// blocks outbound fetch to api.team-manager.*.d4h.com — the browser reports
// "NetworkError when attempting to fetch resource" with no HTTP status.
//
// Fallback: CloudTAK's /api/proxy (Admin → Plugin Proxy). Requires proxy::enabled
// and the D4H origin(s) on proxy::whitelist. The D4H Bearer token is forwarded in
// the proxied request Authorization header (not stored server-side).

import { Preferences } from '@capacitor/preferences';

export interface D4HHttpResponse {
    ok:         boolean;
    status:     number;
    statusText: string;
    json():     Promise<unknown>;
    text():     Promise<string>;
}

export class D4HTransportError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'D4HTransportError';
        this.status = status;
    }
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
    const out: Record<string, string> = {};
    if (!headers) return out;
    if (headers instanceof Headers) {
        headers.forEach((v, k) => { out[k] = v; });
        return out;
    }
    if (Array.isArray(headers)) {
        for (const [k, v] of headers) out[k] = v;
        return out;
    }
    return { ...headers };
}

function isDirectFetchBlocked(err: unknown): boolean {
    // CSP / mixed-content / offline — no HTTP response is returned.
    return err instanceof TypeError;
}

function proxyAdminHint(status: number, message: string): string {
    if (status === 403 && /proxy/i.test(message)) {
        return [
            message,
            'Enable Plugin Proxy in CloudTAK Admin → Config and whitelist your D4H API origin(s), e.g.',
            'https://api.team-manager.us.d4h.com',
            '(add .eu / .ap / .ca for other regions).',
        ].join(' ');
    }
    if (status === 401) {
        return `${message} Log out of CloudTAK, sign in again, then retry.`;
    }
    return message;
}

async function cloudTakSessionToken(): Promise<string> {
    const { value } = await Preferences.get({ key: 'token' });
    const token = value?.trim();
    if (!token) {
        throw new D4HTransportError('CloudTAK session missing — log in again, then retry.');
    }
    return token;
}

function wrapNative(res: Response): D4HHttpResponse {
    return {
        ok:         res.ok,
        status:     res.status,
        statusText: res.statusText,
        json:       () => res.json(),
        text:       () => res.text(),
    };
}

function wrapProxyPayload(
    status: number,
    body: unknown,
    encoding?: string,
): D4HHttpResponse {
    let textBody: string;
    if (encoding === 'base64' && typeof body === 'string') {
        textBody = atob(body);
    } else if (typeof body === 'string') {
        textBody = body;
    } else {
        textBody = JSON.stringify(body ?? '');
    }

    return {
        ok:         status >= 200 && status < 300,
        status:     status,
        statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
        async json() {
            if (body !== null && typeof body === 'object') return body;
            return JSON.parse(textBody);
        },
        async text() {
            return textBody;
        },
    };
}

async function fetchViaProxy(url: string, init: RequestInit = {}): Promise<D4HHttpResponse> {
    const method = String(init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
        throw new D4HTransportError(`Proxy transport does not support ${method} (CloudTAK /api/proxy allows GET and POST only).`);
    }

    const token = await cloudTakSessionToken();
    const headers = headersToRecord(init.headers);

    let body: unknown;
    if (init.body != null && method !== 'GET') {
        body = typeof init.body === 'string' ? init.body : String(init.body);
        try {
            body = JSON.parse(body as string);
        } catch {
            // leave as raw string
        }
    }

    let res: Response;
    try {
        res = await fetch('/api/proxy', {
            method:      'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Authorization:  `Bearer ${token}`,
            },
            body: JSON.stringify({ url, method, headers, body }),
        });
    } catch (e) {
        throw new D4HTransportError(`Proxy request failed: ${(e as Error).message}`);
    }

    let payload: {
        status?:  number;
        body?:    unknown;
        encoding?: string;
        message?: string;
    };
    try {
        payload = await res.json() as typeof payload;
    } catch {
        throw new D4HTransportError(`Proxy returned non-JSON (${res.status})`, res.status);
    }

    if (!res.ok) {
        const message = proxyAdminHint(res.status, payload.message ?? `Proxy request failed (${res.status})`);
        throw new D4HTransportError(message, res.status);
    }

    const status = typeof payload.status === 'number' ? payload.status : 0;
    return wrapProxyPayload(status, payload.body, payload.encoding);
}

/**
 * GET/POST to D4H. Tries a direct browser fetch first; on CSP/network block,
 * retries through CloudTAK /api/proxy.
 */
export async function d4hFetch(url: string, init: RequestInit = {}): Promise<D4HHttpResponse> {
    try {
        const res = await fetch(url, init);
        return wrapNative(res);
    } catch (e) {
        if (!isDirectFetchBlocked(e)) throw e;
        console.debug('[d4h] direct fetch blocked — retrying via CloudTAK /api/proxy');
        return fetchViaProxy(url, init);
    }
}
