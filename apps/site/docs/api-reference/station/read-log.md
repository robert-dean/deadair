---
title: 'Read log'
sidebar_label: 'Read log'
sidebar_position: 2
mdx:
    format: 'md'
---

A tail of one log, newest first

**`GET`** `/logs/{id}`

:::note
SDK method: `readLog`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type       | Required | Description                                    |
| --------- | ---------- | -------- | ---------------------------------------------- |
| `id`      | `string`   | Yes      | Path parameter.                                |
| `level`   | `LogLevel` | No       | Ignored by a source whose lines carry no level |
| `limit`   | `number`   | No       |                                                |

</details>

## Response

`200 OK` — Returns a [LogPage](../models/station/log-page.md) object.

`404 Not Found`
