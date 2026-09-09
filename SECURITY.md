# Security

## Reporting something

Report privately, through [GitHub's security
advisories](https://github.com/robert-dean/deadair/security/advisories/new) on this repository, and
not as a public issue. There is one maintainer, so expect a human rather than an SLA; you will get
an acknowledgement, and a fix or a reason there will not be one.

The latest release is the supported version. There are no backports to older tags.

## What deadair assumes about where it runs

Worth knowing before you decide whether something is a bug.

**The stream is not authenticated.** The mount is meant to be listened to. Anyone who can reach the
published port can hear the station, and the console's API sits behind the same port under `/api`
with its own authentication in front of it. Putting the station on the public internet means putting
the mount there too, on purpose.

**The container trusts forwarded headers**, so it can report a real listener address from behind a
proxy. Bound it with `REAL_IP_FROM`, which names the proxy the station will believe. Without it,
every listener can look like one address, which collapses the audience count and puts everybody in
one rate-limit bucket.

**Plugins are trusted code, permanently.** They run in this process with this process's own
privileges. The enable dialog says so before you turn one on. The egress layer protects an honest
plugin from a hostile upstream and the operator from a careless plugin; it does not contain a
hostile one, and no future version will. Install plugins the way you would install anything else
that runs as you. The reasoning is in `packages/plugin-sdk/CLAUDE.md` under "Trust and egress".

**Credentials are encrypted at rest with a key you hold.** `KMS_LOCAL_ROOT_KEY` encrypts every
stored credential; an API key typed into the console is never shown again and never returned by the
API. Lose that key and you re-enter every credential. It is not in the database, and it should not
be in the same backup as the database.

**Sessions are held in Redis** and actors in Postgres, so restoring one without the other leaves
tokens verifying against users who no longer exist. The station rejects that state rather than
trusting it.

**One thing genuinely thin**, stated because it is better said than found: the admin password
minimum is eight characters with no breach check, on the account that owns the whole station. Use a
long one, and enrol an authenticator from Settings → Security.
