---
title: 'PlayoutStationPlaylistInput'
sidebar_position: 2
mdx:
    format: 'md'
---

> A playlist the station owns, to load into the running order

<details>
<summary>Attributes (2)</summary>

| Attribute           | Type      | Required | Description                                                                                                                                                                      |
| ------------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stationPlaylistId` | `string`  | Yes      |                                                                                                                                                                                  |
| `mixInSimilar`      | `boolean` | No       | Whether records that sound like the ones on this playlist are mixed in among them, one every `rotation.mixInEvery` records. Absent takes the station's own setting, which is off |

</details>
