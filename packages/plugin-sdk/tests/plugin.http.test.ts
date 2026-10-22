import { describe, expect, it } from 'vitest';

import { PluginError } from '../src/plugin.error.js';
import {
    HOST_FETCH_METHODS,
    headersToRecord,
    hostFetchMethod,
    pluginCodeForStatus,
    retryAfterMs,
    truncateUpstreamMessage,
    UpstreamRequestError,
    upstreamDetail,
    upstreamField,
} from '../src/plugin.http.js';

describe('truncateUpstreamMessage', () => {
    it('leaves a short message alone', () => {
        expect(truncateUpstreamMessage('no such recording')).toBe('no such recording');
    });

    it('cuts at 200 characters and marks the cut', () => {
        const truncated = truncateUpstreamMessage('x'.repeat(500));

        expect(truncated).toHaveLength(201);
        expect(truncated.endsWith('…')).toBe(true);
    });

    it('does not mark a message of exactly the limit', () => {
        expect(truncateUpstreamMessage('x'.repeat(200))).toBe('x'.repeat(200));
    });
});

describe('upstreamField', () => {
    it('reads a nested string', () => {
        const body = JSON.stringify({ error: { message: 'premium required' } });

        expect(upstreamField(body, parsed => (parsed as { error?: { message?: unknown } }).error?.message)).toBe('premium required');
    });

    it('answers undefined for a body that is not JSON at all', () => {
        expect(upstreamField('<html>502 Bad Gateway</html>', parsed => parsed)).toBeUndefined();
    });

    it('answers undefined for an absent, empty or non-string field', () => {
        expect(upstreamField(undefined, parsed => parsed)).toBeUndefined();
        expect(upstreamField('', parsed => parsed)).toBeUndefined();
        expect(upstreamField(JSON.stringify({ error: '' }), parsed => (parsed as { error?: unknown }).error)).toBeUndefined();
        expect(upstreamField(JSON.stringify({ error: 42 }), parsed => (parsed as { error?: unknown }).error)).toBeUndefined();
    });

    it('answers undefined when the picker itself throws', () => {
        expect(
            upstreamField(JSON.stringify({}), () => {
                throw new Error('picker blew up');
            }),
        ).toBeUndefined();
    });
});

describe('retryAfterMs', () => {
    it('reads whole seconds as milliseconds', () => {
        expect(retryAfterMs('3')).toBe(3000);
        expect(retryAfterMs(' 12 ')).toBe(12_000);
        expect(retryAfterMs('0')).toBe(0);
    });

    it('treats an absent header as no advice, from either shape', () => {
        expect(retryAfterMs(undefined)).toBeUndefined();
        expect(retryAfterMs(null)).toBeUndefined();
    });

    it('refuses the HTTP-date form rather than guessing at it', () => {
        expect(retryAfterMs('Wed, 21 Oct 2015 07:28:00 GMT')).toBeUndefined();
    });

    it('refuses a negative wait', () => {
        expect(retryAfterMs('-5')).toBeUndefined();
    });
});

describe('pluginCodeForStatus', () => {
    it('reads the rows every upstream agrees on', () => {
        expect(pluginCodeForStatus(404)).toBe('not_found');
        expect(pluginCodeForStatus(429)).toBe('rate_limited');
        expect(pluginCodeForStatus(500)).toBe('unavailable');
        expect(pluginCodeForStatus(503)).toBe('unavailable');
    });

    it('leaves anything else as the upstream being unhelpful', () => {
        expect(pluginCodeForStatus(400)).toBe('upstream');
        expect(pluginCodeForStatus(401)).toBe('upstream');
        expect(pluginCodeForStatus(403)).toBe('upstream');
        expect(pluginCodeForStatus(418)).toBe('upstream');
    });
});

describe('upstreamDetail', () => {
    it('joins what it was given', () => {
        expect(upstreamDetail(403, 'Forbidden', 'premium required')).toBe('HTTP 403 Forbidden premium required');
    });

    it('leaves no holes when the upstream said less', () => {
        expect(upstreamDetail(500, 'Internal Server Error')).toBe('HTTP 500 Internal Server Error');
        expect(upstreamDetail(500)).toBe('HTTP 500');
        expect(upstreamDetail(500, '', '')).toBe('HTTP 500');
    });
});

describe('hostFetchMethod', () => {
    it('accepts every method the host carries, in any case', () => {
        for (const method of HOST_FETCH_METHODS) {
            expect(hostFetchMethod(method.toLowerCase())).toBe(method);
        }
    });

    it('defaults an absent method to GET, the way fetch does', () => {
        expect(hostFetchMethod(undefined)).toBe('GET');
    });

    it('answers undefined rather than throwing, so the caller picks the words', () => {
        expect(hostFetchMethod('TRACE')).toBeUndefined();
        expect(hostFetchMethod('OPTIONS')).toBeUndefined();
    });
});

describe('headersToRecord', () => {
    it('lower-cases names', () => {
        expect(headersToRecord(new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' }))).toEqual({
            'content-type': 'application/json',
            accept: 'application/json',
        });
    });

    it('is empty for no headers', () => {
        expect(headersToRecord(new Headers())).toEqual({});
    });
});

describe('UpstreamRequestError', () => {
    class ExampleRequestError extends UpstreamRequestError {
        constructor(message: string, status: number) {
            super(status, message);
            this.name = 'ExampleRequestError';
        }

        get isMissing(): boolean {
            return this.status === 404;
        }
    }

    it('classifies from the status and records it, so a subclass only names itself', () => {
        const error = new ExampleRequestError('no such thing', 404);

        expect(error).toBeInstanceOf(ExampleRequestError);
        expect(error).toBeInstanceOf(UpstreamRequestError);
        expect(error).toBeInstanceOf(PluginError);
        expect(error.name).toBe('ExampleRequestError');
        expect(error.status).toBe(404);
        expect(error.upstreamStatus).toBe(404);
        expect(error.code).toBe('not_found');
        expect(error.isMissing).toBe(true);
    });

    it('takes a code of its own over the shared ladder', () => {
        expect(new UpstreamRequestError(401, 'bad token', { code: 'config' }).code).toBe('config');
    });

    it('keeps the retry advice even when the code would not be retryable on its own', () => {
        const error = new UpstreamRequestError(400, 'slow down', { code: 'upstream', retryAfterMs: 2_000 });

        expect(error.retryable).toBe(true);
        expect(error.retryAfterMs).toBe(2_000);
    });

    it('carries the service code, and leaves a 200 off upstreamStatus because the failure was inside it', () => {
        const error = new UpstreamRequestError(200, 'refused', { code: 'config', upstreamCode: 10 });

        expect(error.status).toBe(200);
        expect(error.upstreamStatus).toBeUndefined();
        expect(error.upstreamCode).toBe(10);
    });

    it('allows no status at all for a failure that came back inside an envelope', () => {
        const error = new UpstreamRequestError<number | undefined>(undefined, 'not found', { code: 'not_found', upstreamCode: 70 });

        expect(error.status).toBeUndefined();
        expect(error.upstreamStatus).toBeUndefined();
        expect(error.code).toBe('not_found');
    });

    it('defaults a status-less failure to upstream', () => {
        expect(new UpstreamRequestError<number | undefined>(undefined, 'odd answer').code).toBe('upstream');
    });

    it('keeps the cause', () => {
        const cause = new Error('socket hang up');
        expect(new UpstreamRequestError(502, 'bad gateway', { cause }).cause).toBe(cause);
    });
});
