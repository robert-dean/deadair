---
title: 'FactClaim'
sidebar_position: 30
mdx:
    format: 'md'
---

> One thing the station believes, and the words it read that say so. Extracted by the host out of
> an article a plugin handed over, rather than said by any plugin: `sourceUrl` is where a person
> checks it and `sourceQuote` is the span that supports it, and neither is ever absent.

<details>
<summary>Attributes (10)</summary>

| Attribute        | Type     | Required | Description                                                                       |
| ---------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `id`             | `string` | Yes      | _read-only_                                                                       |
| `claim`          | `string` | Yes      | One sentence, as the DJ would say it. _read-only_                                 |
| `category`       | `string` | Yes      | _read-only_                                                                       |
| `source`         | `string` | Yes      | `lead` for the article's own opening, `model` for what a model found. _read-only_ |
| `sourceProvider` | `string` | Yes      | _read-only_                                                                       |
| `sourceUrl`      | `string` | Yes      | _read-only_                                                                       |
| `sourceQuote`    | `string` | Yes      | _read-only_                                                                       |
| `confidence`     | `number` | No       | _read-only_                                                                       |
| `model`          | `string` | No       | _read-only_                                                                       |
| `lastUsedAt`     | `string` | No       | Absent means never said on air. _read-only_                                       |

</details>
