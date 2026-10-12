---
title: 'List own show episodes'
sidebar_label: 'List own show episodes'
sidebar_position: 10
mdx:
    format: 'md'
---

A show's episodes, newest first, with how far along each is

**`GET`** `/podcasts/own/{id}/episodes`

:::note
SDK method: `listOwnShowEpisodes`
Security: authenticated (policy: platform.view)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [ProductionList](../models/productions/production-list.md) object.
