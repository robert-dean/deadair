---
title: 'StreamConfigWarning'
sidebar_position: 5
mdx:
    format: 'md'
---

> A stream container still running config the app has replaced. Icecast and Liquidsoap read
> their rendered config ONCE, at startup, and nothing restarts or signals them when it is
> re-rendered — so a reseeded secret leaves a process holding credentials that match nothing,
> and the symptom names something else entirely (every listener refused, or no mount at all).
> The app cannot restart a sibling container and should not be able to, so it reports.

<details>
<summary>Attributes (3)</summary>

| Attribute   | Type                        | Required | Description                                                                     |
| ----------- | --------------------------- | -------- | ------------------------------------------------------------------------------- |
| `container` | `'icecast' \| 'liquidsoap'` | Yes      | Which one is behind                                                             |
| `detail`    | `string`                    | Yes      | What is wrong and how it is known, in a sentence                                |
| `restart`   | `string`                    | Yes      | The exact command that adopts the new config, which is the only thing that does |

</details>
