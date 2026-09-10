---
title: 'StationCheckup'
sidebar_position: 12
mdx:
    format: 'md'
---

> One reading of the machinery, for a page that assembles the station's health.
>
> It carries ONLY the two signals nothing else exposes. Everything else a check-up shows — the
> silence verdict, the listener count, what needs somebody, the plugin statuses, the disk — is
> already on a contract the console reads, and composing them again here would be a second answer
> that can disagree with the first. `/playout/status` in particular is polled every two seconds for
> the transport strip, so asking for it a second way would be a second reading of the same fact.
>
> Each section is OPTIONAL and absent means that reader failed. A page saying what is wrong is the
> worst place for one broken reader to take the whole answer down, which is the rule
> `StationAttentionService` already works to. `revision` is the one exception and says so on its
> own line: it cannot fail, so absent there means something else.
>
> The revision is on THIS contract rather than composed from `/health`, which also reports it, and
> that is not the second-answer problem the paragraph above describes. Both read one string from one
> place at boot, so they cannot disagree. What they differ in is who can reach them: `/health` is
> `operation(internal)`, deliberately, so it generates no SDK method and the console cannot call it
> — which would leave "which build is this" answerable only from a shell, the one thing carrying it
> here exists to fix.

<details>
<summary>Attributes (5)</summary>

| Attribute    | Type                 | Required | Description                                                                                                                                                                                                                                                                            |
| ------------ | -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readAt`     | `string`             | Yes      | When this reading was taken, so a stale page cannot pass itself off as now. _read-only_                                                                                                                                                                                                |
| `revision`   | `string`             | No       | The commit this station was built from, as the image's `org.opencontainers.image.revision` label says it. Unlike the sections below, absent is not a failed reader: it means nothing stamped this build, which is what a development tree and a hand-built image both are. _read-only_ |
| `version`    | `string`             | No       | The release this station is, as the image's `org.opencontainers.image.version` label says it. Absent on the same terms as `revision` and for a second reason: only a tagged build carries one, so a station following `latest` reports a commit and no version. _read-only_            |
| `heartbeats` | `StationHeartbeat[]` | No       | _read-only_                                                                                                                                                                                                                                                                            |
| `backlog`    | `StationBacklog`     | No       | _read-only_                                                                                                                                                                                                                                                                            |

</details>
