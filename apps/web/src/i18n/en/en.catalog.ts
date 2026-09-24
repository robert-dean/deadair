import { common } from './common.catalog';

/**
 * Every English namespace. English is the source language: it is bundled with the console and
 * is what any other locale falls back to key by key, and its shape is the type every other
 * locale's catalog is checked against.
 */
export const en = {
    common,
} as const;
