---
title: 'Test event destination'
sidebar_label: 'Test event destination'
sidebar_position: 7
mdx:
    format: 'md'
---

Send a destination a test event now, and say what it answered. Sent even when the destination is off

**`POST`** `/events/destinations/{id}/test`

:::note
SDK method: `testEventDestination`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `id`      | `string` | Yes      | Path parameter. |

</details>

## Response

`200 OK` — Returns a [EventTestResult](../models/events/event-test-result.md) object.
