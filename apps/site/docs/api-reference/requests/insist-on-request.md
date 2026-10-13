---
title: 'Insist on request'
sidebar_label: 'Insist on request'
sidebar_position: 5
mdx:
    format: 'md'
---

Ask again for a record the station turned down for its own taste, overruling it. Only your own request, only one marked `overrulable`, and only once. Answers with the NEW request this makes, decided like any other: it can still wait for an operator, or be refused for who is asking or how full the line is

**`POST`** `/requests/{id}/insist`

:::note
SDK method: `insistOnRequest`
Security: authenticated (policy: requests.ask)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`201 Created` — Returns a [ListenerRequest](../models/requests/listener-request.md) object.
