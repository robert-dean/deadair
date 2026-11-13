---
paths:
    - 'apps/api/src/**/*.ts'
    - 'apps/api/.env.example'
---

# Settings and config reads

Every layer of `AppConfig` holds STRINGS: dotenv, and `deadair.settings`, whose rows are snapshotted as raw text. The reasoning and the six live bugs it caused are in `apps/api/CLAUDE.md` § "A setting is a string, and that is the whole of it".

- Never read a switch as a boolean. `config.get(key, false)` answers the string `'false'`, which is truthy. Read on/off through `settingIsOn` (`apps/api/src/modules/shared/setting.flags.ts`).
- Never read a number through `config.get(key, 5432)`: it types as `number` and answers a string. Use the resolvers in `apps/api/src/modules/shared/setting.numbers.ts` (`requiredNumber` and its siblings).
- Declare a new setting in `settings.registry.ts` as a `ConfigField`, and have the module's typed resolver share the registry's default and range so the two cannot disagree. The resolver CLAMPS a stored value; `serializeSetting` REFUSES an out-of-range one being typed.
- A secret setting that is sent somewhere names where with `sentTo`, so a save that moves the address to another origin is refused.
- A setting written inside a request is not readable through the config in that same request (Postgres holds `NOTIFY` until COMMIT). Reload through `AfterCommit`, and answer from what was written, not from a re-read.
- A test of a switch's off-case passes the STRING `'false'`. A real boolean passes either way and proves nothing; a config double that coerces is worse than none.
