---
title: 'Dismiss station attention'
sidebar_label: 'Dismiss station attention'
sidebar_position: 5
mdx:
    format: 'md'
---

Accept an attention row as it stands, until something new joins it

**`POST`** `/station/attention/{code}/dismiss`

:::note
SDK method: `dismissStationAttention`
Security: authenticated (policy: platform.manage)
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type     | Required | Description     |
| --------- | -------- | -------- | --------------- |
| `code`    | `string` | Yes      | Path parameter. |

</details>

## Response

`204 No Content`
