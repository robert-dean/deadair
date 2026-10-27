---
title: 'Get recording audio'
sidebar_label: 'Get recording audio'
sidebar_position: 3
mdx:
    format: 'md'
---

The audio of one recording. Answers a byte range, so a player can seek through an hour

**`GET`** `/archive/recordings/{id}/audio`

:::note
SDK method: `getRecordingAudio`
Security: public
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type      | Required | Description     |
| ---------- | --------- | -------- | --------------- |
| `id`       | `string`  | Yes      | Path parameter. |
| `download` | `boolean` | No       |                 |
| `range`    | `string`  | No       |                 |

</details>

## Response

`200 OK` — Returns `Blob`.

Response headers:

| Header                | Type     | Description |
| --------------------- | -------- | ----------- |
| `accept-ranges`       | `string` |             |
| `content-disposition` | `string` |             |

`206` — Returns `Blob`.

Response headers:

| Header          | Type                  | Description |
| --------------- | --------------------- | ----------- |
| `accept-ranges` | `string`              |             |
| `content-range` | `string` _(required)_ |             |
