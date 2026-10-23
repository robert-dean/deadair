---
title: 'Read as-run log'
sidebar_label: 'Read as-run log'
sidebar_position: 2
mdx:
    format: 'md'
---

The as-run log, newest first, one page at a time

**`GET`** `/history/as-run`

:::note
SDK method: `readAsRunLog`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type     | Required | Description                                                                                                 |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `before`  | `string` | No       | Where the previous page ended. Opaque: pass back whatever `nextBefore` said                                 |
| `limit`   | `number` | No       |                                                                                                             |
| `until`   | `string` | No       | Start reading from this moment back, to jump to an hour without paging to it. Ignored when `before` is sent |

</details>

## Response

`200 OK` — Returns a [AsRunPage](../models/history/as-run-page.md) object.
