#!/usr/bin/env python3
"""Move a build that is already in Play, without rebuilding it.

Three things the upload path cannot do, because it can only publish something new:

  * make a draft live on the track it is already on
  * carry a build from one track to a wider one
  * move a staged rollout: widen it, halt it, or finish it

All three are the same API call — a track's releases are a list of version codes with a status, so
"promote" is writing that list somewhere else, or writing it back with a different status. No
artifact is uploaded and no signing key is involved, which is why the workflow runs this in a job
that is handed neither.

A staged rollout is a release with status `inProgress` and a `userFraction`. Widening it is writing
it back with a larger fraction, halting it is writing it back as `halted`, and finishing it is
writing it back as `completed`. Play needs only that one release in the request, not the completed
one the rest of the users are still on.

Credentials come from PLAY_SERVICE_ACCOUNT_JSON, the key's JSON itself rather than a path, which is
the shape a CI secret already has.

    promote-play-release.py --package com.example.app --from-track internal --to-track internal \
        --status completed [--version-code 1288]

    promote-play-release.py --package com.example.app --from-track production --to-track production \
        --status inProgress --user-fraction 0.5

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
    p.add_argument('--user-fraction', type=float, default=None)
    args = p.parse_args()

    # Checked before any credentials are read, because the API's own refusal arrives after an edit
    # has been opened and names the field without saying which status wanted it.
    if args.status == 'inProgress':
        if args.user_fraction is None or not 0 < args.user_fraction < 1:
            fail('inProgress needs a --user-fraction above 0 and below 1, such as 0.2.')
    elif args.user_fraction is not None:
        fail(f'--user-fraction applies only to inProgress. {args.status} does not take one.')

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
    target = args.status if args.user_fraction is None else f'{args.status} at {args.user_fraction:.0%}'
    print(f'promoting {codes} from {args.from_track} ({chosen.get("status")}) to {args.to_track} ({target})')

    release = {'versionCodes': codes, 'status': args.status}
    if args.user_fraction is not None:
        release['userFraction'] = args.user_fraction
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
    print(f'done: {codes} is {target} on {args.to_track}')


if __name__ == '__main__':
    main()
