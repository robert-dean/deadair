---
title: 'AddStationTrackInput'
sidebar_position: 16
mdx:
    format: 'md'
---

> Put a catalog record into the running order. Refused at the door — 404 for a record the catalog does not hold, 422 for one whose audio is not local yet — rather than accepted and left to fail when it comes round

<details>
<summary>Attributes (2)</summary>

| Attribute | Type     | Required | Description                                                                                    |
| --------- | -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `trackId` | `string` | Yes      |                                                                                                |
| `atIndex` | `number` | No       | Where to put it. Absent puts it at the end. A position already handed to the player is refused |

</details>
