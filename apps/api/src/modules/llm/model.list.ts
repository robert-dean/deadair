import type { AppConfig } from '@maroonedsoftware/appconfig';
import { parseRows } from '@deadair/plugin-sdk';

/** The one column a model list's rows carry: a qualified `provider:model`. */
export const MODEL_LIST_COLUMN = 'model';

/**
 * The models one kind of call may ask, in the order the operator put them.
 *
 * Every per-action model setting is a `list` with one `model` column, so this is
 * `[{"model":"local:qwen"},{"model":"cloud:sonnet"}]`, read through the SDK's own `parseRows` and each
 * model kept once. Empty means the plugin's own default, which is what an empty setting always meant.
 *
 * A plain `provider:model` string is still read as a list of one. Every such setting was a single model
 * before it was a list, and the migration that rewrote them is not the only way a row gets written:
 * a value set by hand, or restored from an older backup, keeps working rather than silently meaning
 * the default.
 */
export function modelList(config: AppConfig, key: string): string[] {
    return readModelList(config.get(key, ''));
}

/** {@link modelList} over a raw stored value, for a caller that already has one. */
export function readModelList(raw: unknown): string[] {
    if (typeof raw !== 'string') return [];
    const value = raw.trim();
    if (value.length === 0) return [];
    if (!value.startsWith('[')) return [value];

    const models = parseRows(value)
        .map(row => row[MODEL_LIST_COLUMN]?.trim() ?? '')
        .filter(model => model.length > 0);
    return [...new Set(models)];
}
