#!/usr/bin/env python3
"""Move a build that is already in Play, without rebuilding it.

Two things the upload path cannot do, because it can only publish something new:

  * make a draft live on the track it is already on
  * carry a build from one track to a wider one

Both are the same API call — a track's releases are a list of version codes with a status, so
"promote" is writing that list somewhere else, or writing it back with a different status. No
artifact is uploaded and no signing key is involved, which is why the workflow runs this in a job
that is handed neither.

Credentials come from PLAY_SERVICE_ACCOUNT_JSON, the key's JSON itself rather than a path, which is
the shape a CI secret already has.

    promote-play-release.py --package com.example.app --from-track internal --to-track internal \
        --status completed [--version-code 1288]

With no --version-code it takes whatever is on the source track, which is almost always what you
mean and is the difference between this being one command and being a lookup followed by a command.
"""

import argparse
import json
import os
import sys

from google.oauth2 import service_account
import google.auth.transport.requests as google_requests

API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications'
SCOPES = ['https://www.googleapis.com/auth/androidpublisher']


def fail(message):
    print(f'::error::{message}' if os.environ.get('GITHUB_ACTIONS') else f'error: {message}', file=sys.stderr)
    raise SystemExit(1)


def check(response, what):
    if response.status_code >= 400:
        try:
            detail = response.json().get('error', {}).get('message', response.text)
        except ValueError:
            detail = response.text
        fail(f'{what} failed with HTTP {response.status_code}: {detail}')
    return response.json() if response.content else {}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--package', required=True)
    p.add_argument('--from-track', default='internal')
    p.add_argument('--to-track', default='internal')
    p.add_argument('--status', default='completed', choices=['completed', 'draft', 'halted', 'inProgress'])
    p.add_argument('--version-code', type=int, default=None)
    args = p.parse_args()

    raw = os.environ.get('PLAY_SERVICE_ACCOUNT_JSON', '').strip()
    if not raw:
        fail('PLAY_SERVICE_ACCOUNT_JSON is not set.')
    credentials = service_account.Credentials.from_service_account_info(json.loads(raw), scopes=SCOPES)
    session = google_requests.AuthorizedSession(credentials)

    base = f'{API}/{args.package}/edits'
    edit = check(session.post(base), 'Creating an edit')['id']
    print(f'edit {edit}')

    # What is on the source track, which is where the version codes and the release notes come from.
    source = check(session.get(f'{base}/{edit}/tracks/{args.from_track}'), f'Reading the {args.from_track} track')
    releases = source.get('releases') or []
    if not releases:
        fail(f'The {args.from_track} track has no releases to promote.')

    if args.version_code is None:
        chosen = max(releases, key=lambda r: max(int(v) for v in r.get('versionCodes') or [0]))
    else:
        chosen = next((r for r in releases if str(args.version_code) in (r.get('versionCodes') or [])), None)
        if chosen is None:
            available = sorted(int(v) for r in releases for v in r.get('versionCodes') or [])
            fail(f'Version code {args.version_code} is not on the {args.from_track} track. There: {available}')

    codes = chosen.get('versionCodes') or []
    print(f'promoting {codes} from {args.from_track} ({chosen.get("status")}) to {args.to_track} ({args.status})')

    release = {'versionCodes': codes, 'status': args.status}
    # Carried rather than dropped: notes belong to the build, not to the track it sits on.
    if chosen.get('releaseNotes'):
        release['releaseNotes'] = chosen['releaseNotes']
    if chosen.get('name'):
        release['name'] = chosen['name']

    check(
        session.put(f'{base}/{edit}/tracks/{args.to_track}', json={'track': args.to_track, 'releases': [release]}),
        f'Writing the {args.to_track} track',
    )
    check(session.post(f'{base}/{edit}:commit'), 'Committing the edit')
    print(f'done: {codes} is {args.status} on {args.to_track}')


if __name__ == '__main__':
    main()
