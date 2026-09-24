---
title: 'List requests'
sidebar_label: 'List requests'
sidebar_position: 2
mdx:
    format: 'md'
---

Every recent request, for the operator deciding on them

**`GET`** `/requests`

:::note
SDK method: `listRequests`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type            | Required | Description |
| --------- | --------------- | -------- | ----------- |
| `status`  | `RequestStatus` | No       |             |

</details>

## Response

`200 OK` — Returns a [ListenerRequestList](../models/requests/listener-request-list.md) object.
