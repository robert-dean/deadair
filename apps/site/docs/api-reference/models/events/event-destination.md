---
title: 'EventDestination'
sidebar_position: 1
mdx:
    format: 'md'
---

> Somewhere the station sends what happens on it: an operator's own server, sent a signed POST per event

<details>
<summary>Attributes (6)</summary>

| Attribute   | Type      | Required | Description                                                                                                          |
| ----------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`  | Yes      | _read-only_                                                                                                          |
| `name`      | `string`  | Yes      | What the operator calls it                                                                                           |
| `url`       | `string`  | Yes      | Where events are POSTed. http or https, and allowed to be on the station's own network. A redirect is never followed |
| `enabled`   | `boolean` | Yes      | Off sends nothing                                                                                                    |
| `createdAt` | `string`  | Yes      | _read-only_                                                                                                          |
| `updatedAt` | `string`  | Yes      | _read-only_                                                                                                          |

</details>
