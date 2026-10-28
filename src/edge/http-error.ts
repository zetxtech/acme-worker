export interface HttpDiagnostic {
    method: string;
    url: string;
    action: string;
    status: number;
    statusText: string;
    responseBody: string;
    requestId?: string;
    truncated?: boolean;
}

const sensitiveField = /authorization|signature|private.?key|access.?key|secret|password|token|credential/i;

function sensitiveValues(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value).flatMap(([key, entry]) => sensitiveField.test(key) && typeof entry === 'string'
        ? [entry] : sensitiveValues(entry));
}

export function redactCloudText(value: string, secrets: string[]): string {
    let safe = value;
    for (const secret of [...new Set(secrets)].filter(Boolean).sort((left, right) => right.length - left.length)) {
        for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
            safe = safe.split(form).join('[redacted]');
        }
    }
    return safe.replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, '[redacted private key]')
        .replace(/\bAuthorization\s*[:=][^\r\n]*/gi, 'Authorization: [redacted]')
        .replace(/\bSignature\s*=\s*[a-zA-Z0-9+/=_-]+/gi, 'Signature=[redacted]');
}

function redactedResponse(raw: string, secrets: string[]): string {
    try {
        const scrub = (value: any): any => {
            if (Array.isArray(value)) return value.map(scrub);
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
                .map(([key, entry]) => [key, sensitiveField.test(key) ? '[redacted]' : scrub(entry)]));
            return typeof value === 'string' ? redactCloudText(value, secrets) : value;
        };
        return JSON.stringify(scrub(JSON.parse(raw)), null, 2);
    } catch { return redactCloudText(raw, secrets); }
}

export class CloudHttpError extends Error {
    diagnostic: HttpDiagnostic;
    constructor(summary: string, request: {url: string; action: string; parameters?: unknown},
        response: {status: number; statusText: string; body: string; requestId?: string}, credentials: string[]) {
        const secrets = [...credentials, ...sensitiveValues(request.parameters)];
        super(redactCloudText(summary, secrets).slice(0, 500));
        this.name = 'CloudHttpError';
        const url = new URL(request.url);
        for (const [key, value] of [...url.searchParams]) {
            url.searchParams.set(key, sensitiveField.test(key) || /certificate/i.test(key) ? '[redacted]' : redactCloudText(value, secrets));
        }
        const body = redactedResponse(response.body, secrets);
        this.diagnostic = {method: 'POST', url: url.toString().slice(0, 4096), action: request.action,
            status: response.status, statusText: redactCloudText(response.statusText, secrets), responseBody: body.slice(0, 8192),
            requestId: response.requestId ? redactCloudText(response.requestId, secrets) : undefined, truncated: body.length > 8192};
    }
}

export function httpDiagnostic(error: unknown, secrets: string[] = []): HttpDiagnostic | undefined {
    if (!(error instanceof CloudHttpError)) return undefined;
    const diagnostic = error.diagnostic;
    return {...diagnostic, url: redactCloudText(diagnostic.url, secrets), statusText: redactCloudText(diagnostic.statusText, secrets),
        responseBody: redactCloudText(diagnostic.responseBody, secrets),
        requestId: diagnostic.requestId ? redactCloudText(diagnostic.requestId, secrets) : undefined};
}