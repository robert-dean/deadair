---
title: 'Write a running order break again'
sidebar_label: 'Write a running order break again'
sidebar_position: 31
mdx:
    format: 'md'
---

Writes a break still to come again from nothing: its words, and any audio already made of them, are thrown away and the station writes it afresh as its slot nears, under whoever is presenting by then. Reaches a break that failed to be written, which nothing else retries, so a break that had nothing to say can be asked again after the phrasings change or the model is switched on. Only a break the station wrote itself and has not handed to the player, and never one turn of a programme on its own

**`POST`** `/director/air/items/{itemId}/rewrite`

:::note
SDK method: `writeARunningOrderBreakAgain`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `itemId`  | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [StationOrder](../models/director/station-order.md) object.
