import { describe, expect, it, vi } from 'vitest';

import { variadicLogger } from '../src/plugin.logger.js';

describe('variadicLogger', () => {
    it('passes a plain object after the message on as metadata, and drops anything else', () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        const adapted = variadicLogger(logger);

        adapted.warn('socket closed', { code: 4000 });
        adapted.info('reconnecting', 'attempt 2');
        adapted.error(new Error('boom'), ['not', 'meta']);

        expect(logger.warn).toHaveBeenCalledWith('socket closed', { code: 4000 });
        expect(logger.info).toHaveBeenCalledWith('reconnecting', undefined);
        expect(logger.error).toHaveBeenCalledWith('Error: boom', undefined);
    });

    it('writes trace as debug, the finest level the host keeps', () => {
        const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
        variadicLogger(logger).trace('frame', { op: 1 });

        expect(logger.debug).toHaveBeenCalledWith('frame', { op: 1 });
    });
});
