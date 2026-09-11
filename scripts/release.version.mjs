// Turns the pending changesets into versions and changelog entries, for the four things this tree
// releases: the station, the Android listener, the desktop app and the iOS listener.
//
//     pnpm release:version [--summary <file>]    bump, write the changelogs, mirror the app versions
//     pnpm release:version --sync                 mirror the app versions only
//     pnpm release:version --check                fail if a mirrored version disagrees with its manifest
//
// The bump itself is changesets' own `changeset version`, so the fixed group and the bump
// arithmetic are its rules and not a second copy of them. What it does not do is the changelogs:
// `changelog` is false in `.changeset/config.json`, because its generator writes one file per
// package and this tree has seventeen packages and one station. So this reads the changesets
// BEFORE they are consumed, lets changesets bump, then writes one entry per unit that moved.
//
// If it fails after `changeset version` has run, the tree is half-applied. Put it back with
//
//     git checkout -- . && git clean -fd .changeset

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangesetFile } from '@changesets/parse';
import { MIRRORS, UNITS, changesetsFor, insertEntry, pullRequestBody, readMirror, renderBullets, writeMirror } from './release.changelog.mjs';

const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(join(root, file), 'utf8');
const write = (file, text) => writeFileSync(join(root, file), text);
const versionOf = manifest => JSON.parse(read(manifest)).version;
const unitById = Object.fromEntries(UNITS.map(unit => [unit.id, unit]));

function fail(message) {
    console.error(message);
    process.exit(1);
}

function pendingChangesets() {
    return readdirSync(join(root, '.changeset'))
        .filter(file => file.endsWith('.md') && file.toLowerCase() !== 'readme.md')
        .sort()
        .map(file => ({ id: file.replace(/\.md$/, ''), ...parseChangesetFile(read(join('.changeset', file))) }));
}

function mirrorVersions() {
    for (const mirror of MIRRORS) {
        const version = versionOf(unitById[mirror.unit].manifest);
        const text = read(mirror.file);
        const next = writeMirror(text, mirror, version);
        if (next !== text) {
            write(mirror.file, next);
            console.log(`${mirror.file} now says ${version}`);
        }
    }
}

function check() {
    let drift = 0;
    for (const mirror of MIRRORS) {
        const manifest = unitById[mirror.unit].manifest;
        const stated = readMirror(read(mirror.file), mirror);
        const version = versionOf(manifest);
        if (stated !== version) {
            console.error(`${mirror.file} says ${stated}, ${manifest} says ${version}.`);
            drift++;
        }
    }
    if (drift > 0) {
        fail('Change the version in package.json (or write a changeset), then run pnpm release:version --sync.');
    }
    console.log('The listener apps’ versions are in step with their manifests.');
}

function version(summaryFile) {
    const changesets = pendingChangesets();
    if (changesets.length === 0) {
        fail('No pending changesets.');
    }
    const ignored = JSON.parse(read('.changeset/config.json')).ignore ?? [];
    const before = Object.fromEntries(UNITS.map(unit => [unit.id, versionOf(unit.manifest)]));

    // Its own errors (an unknown package, a changeset mixing ignored and versioned ones) are printed
    // by it and leave the tree untouched, so there is nothing to add but the exit.
    try {
        execFileSync(process.execPath, [fileURLToPath(import.meta.resolve('@changesets/cli/bin.js')), 'version'], { cwd: root, stdio: 'inherit' });
    } catch {
        fail('changeset version failed, and changed nothing.');
    }

    const date = new Date().toISOString().slice(0, 10);
    const released = [];
    for (const unit of UNITS) {
        const previous = before[unit.id];
        const next = versionOf(unit.manifest);
        if (next === previous) {
            continue;
        }
        const summaries = changesetsFor(unit.id, changesets, ignored).map(changeset => changeset.summary);
        const body = renderBullets(summaries.length > 0 ? summaries : ['Version bump.']);
        try {
            write(unit.changelog, insertEntry(read(unit.changelog), { version: next, previous, date, body, tag: unit.tag }));
        } catch (error) {
            fail(`${unit.changelog}: ${error.message}`);
        }
        released.push({ label: unit.label, previous, version: next, body });
        console.log(`${unit.label} ${previous} -> ${next}`);
    }

    mirrorVersions();

    if (summaryFile) {
        writeFileSync(summaryFile, `${pullRequestBody(released)}\n`);
    }
}

const args = process.argv.slice(2);
if (args.includes('--check')) {
    check();
} else if (args.includes('--sync')) {
    mirrorVersions();
} else {
    const at = args.indexOf('--summary');
    version(at >= 0 ? args[at + 1] : undefined);
}
