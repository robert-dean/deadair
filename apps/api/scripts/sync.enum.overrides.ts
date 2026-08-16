import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

// Syncs kysely-codegen column overrides from text columns that carry a
// CHECK (... in (...)) constraint in the migration SQL, so the generated
// Kysely types narrow those columns to string-literal unions instead of bare
// `string`. Runs as part of `build:datatypes` (before kysely-codegen) so the
// overrides in `.kysely-codegenrc.json` stay in sync with the migrations.
//
// Invoked from apps/api (cwd), so the defaults are relative to this package.

type Column = { name: string; default?: string; nullable?: boolean; values?: string[] };

/**
 * An override REPLACES the generated type outright, so it has to carry everything kysely-codegen
 * would otherwise have worked out: the `Generated<>` wrapper for a column with a default, and the
 * `| null` for a nullable one. Every enum column in the schema was `not null` until
 * `track_sources.advisory`, which is why the second half of that only arrived with it — a nullable
 * column typed without its null is a column the code cannot write null to and always reads as set.
 */
const overrideType = (union: string, col: { default?: string; nullable?: boolean }): string => {
    const base = col.nullable ? `${union} | null` : union;
    return col.default ? `Generated<${base}>` : base;
};

const { values: opts } = parseArgs({
    options: {
        dir: { type: 'string', default: 'data/migrations' },
        config: { type: 'string', default: '.kysely-codegenrc.json' },
    },
});

const dir = resolve(process.cwd(), opts.dir!);
const configPath = resolve(process.cwd(), opts.config!);

const columns: Record<string, string> = {};
const files = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

for (const file of files) {
    // Only the up section: a down section re-adding a *pre-widening* CHECK must not win.
    const raw = readFileSync(resolve(dir, file), 'utf8').split(/^--\s*migrate:down\s*$/m)[0]!;
    const sql = stripComments(raw);
    for (const table of extractTables(sql)) {
        for (const col of extractEnumColumns(table.body)) {
            const union = col.values!.map(v => `'${v}'`).join(' | ');
            columns[`${table.schema}.${table.name}.${col.name}`] = overrideType(union, col);
        }
    }
    // A later migration can widen/replace an enum CHECK via ALTER TABLE ... ADD CONSTRAINT; files
    // iterate in timestamp order, so the ALTER overwrites the CREATE's override. An ALTER states
    // only the new value list, so the two facts it does NOT restate -- the default and the
    // nullability -- are read back off the override the CREATE already wrote and carried across.
    for (const alter of extractAlterEnumChecks(sql)) {
        const key = `${alter.schema}.${alter.table}.${alter.column}`;
        const existing = columns[key];
        const union = alter.values.map(v => `'${v}'`).join(' | ');
        columns[key] = overrideType(union, {
            ...(existing?.startsWith('Generated<') ? { default: 'carried' } : {}),
            nullable: existing?.includes('| null') ?? false,
        });
    }
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.overrides = { ...(config.overrides ?? {}), columns };
writeFileSync(configPath, JSON.stringify(config, null, 4) + '\n');

console.log(`Wrote ${Object.keys(columns).length} column overrides to ${configPath}`);

function stripComments(sql: string): string {
    // Strip -- line comments and /* */ block comments, preserving string literals.
    let out = '';
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'") {
            out += ch;
            i++;
            while (i < sql.length && sql[i] !== "'") {
                out += sql[i];
                i++;
            }
            if (i < sql.length) out += sql[i];
            continue;
        }
        if (ch === '-' && sql[i + 1] === '-') {
            while (i < sql.length && sql[i] !== '\n') i++;
            out += '\n';
            continue;
        }
        if (ch === '/' && sql[i + 1] === '*') {
            i += 2;
            while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
            i++; // skip *
            continue;
        }
        out += ch;
    }
    return out;
}

function extractTables(sql: string): Array<{ schema: string; name: string; body: string }> {
    const result: Array<{ schema: string; name: string; body: string }> = [];
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
        const start = re.lastIndex;
        let depth = 1;
        let i = start;
        while (i < sql.length && depth > 0) {
            const ch = sql[i];
            if (ch === "'") {
                i++;
                while (i < sql.length && sql[i] !== "'") i++;
                i++;
                continue;
            }
            if (ch === '(') depth++;
            else if (ch === ')') depth--;
            i++;
        }
        if (depth === 0) {
            const schema = m[1];
            const name = m[2];
            if (schema && name) {
                result.push({ schema, name, body: sql.substring(start, i - 1) });
                re.lastIndex = i;
            }
        }
    }
    return result;
}

function splitTopLevel(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "'") {
            cur += ch;
            i++;
            while (i < body.length && body[i] !== "'") {
                cur += body[i];
                i++;
            }
            if (i < body.length) cur += body[i];
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(cur.trim());
            cur = '';
        } else {
            cur += ch;
        }
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
}

function extractEnumColumns(body: string): Column[] {
    const parts = splitTopLevel(body);
    const textCols = new Map<string, Column>();
    const standaloneChecks = new Map<string, string[]>();

    for (const part of parts) {
        const lower = part.toLowerCase();
        const lead = lower.match(/^\s*(check|constraint|primary\s+key|unique|foreign\s+key|exclude|like)\b/);
        if (lead) {
            // Standalone constraint — look for `check (<col> in ('a', 'b', ...))`.
            const cm = part.match(/check\s*\(\s*([a-zA-Z_]\w*)\s+in\s*\(([\s\S]*?)\)\s*\)/i);
            if (cm && cm[1] && cm[2]) {
                const values = parseStringList(cm[2]);
                if (values.length > 0) standaloneChecks.set(cm[1], values);
            }
            continue;
        }

        const colMatch = part.match(/^\s*([a-zA-Z_]\w*)\s+([a-zA-Z_]\w*)/);
        if (!colMatch) continue;
        const colName = colMatch[1]!;
        const colType = colMatch[2]!.toLowerCase();
        if (colType !== 'text') continue;

        // Absent `not null` is the default in SQL and the interesting case here: the type has to
        // carry the `| null` itself, because an override replaces whatever kysely-codegen inferred.
        const col: Column = { name: colName, nullable: !/\bnot\s+null\b/i.test(part) };

        const defMatch = part.match(/\bdefault\s+('[^']*'|[a-zA-Z_]\w*(?:\([^)]*\))?|-?[0-9.]+|true|false|null)/i);
        if (defMatch && defMatch[1]) col.default = defMatch[1];

        const checkRe = new RegExp(String.raw`check\s*\(\s*${colName}\s+in\s*\(([\s\S]*?)\)\s*\)`, 'i');
        const cm = part.match(checkRe);
        if (cm && cm[1]) {
            const values = parseStringList(cm[1]);
            if (values.length > 0) col.values = values;
        }

        textCols.set(colName, col);
    }

    for (const [name, values] of standaloneChecks) {
        const col = textCols.get(name);
        if (col && !col.values) col.values = values;
    }

    return [...textCols.values()].filter(c => c.values !== undefined);
}

function extractAlterEnumChecks(sql: string): Array<{ schema: string; table: string; column: string; values: string[] }> {
    const result: Array<{ schema: string; table: string; column: string; values: string[] }> = [];
    const re =
        /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\s+add\s+constraint\s+[a-zA-Z_]\w*\s+check\s*\(\s*([a-zA-Z_]\w*)\s+in\s*\(([\s\S]*?)\)\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
        const values = parseStringList(m[4]!);
        if (values.length > 0) result.push({ schema: m[1]!, table: m[2]!, column: m[3]!, values });
    }
    return result;
}

function parseStringList(s: string): string[] {
    return [...s.matchAll(/'([^']*)'/g)].map(m => m[1]!);
}
