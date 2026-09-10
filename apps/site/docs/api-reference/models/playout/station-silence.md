---
title: 'StationSilence'
sidebar_position: 9
mdx:
    format: 'md'
---

> Why the station cannot be heard, as one answer

<details>
<summary>Attributes (5)</summary>

| Attribute | Type             | Required | Description                                                                                                                                                                                                         |
| --------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audible` | `boolean`        | Yes      | Whether the station believes its programme is reaching the mount. NOT whether anybody is hearing it: a station can be audible with no listeners in `always` mode, and can have listeners while airing the local bed |
| `cause`   | `SilenceCause`   | Yes      |                                                                                                                                                                                                                     |
| `detail`  | `string`         | Yes      |                                                                                                                                                                                                                     |
| `remedy`  | `string`         | No       |                                                                                                                                                                                                                     |
| `checks`  | `SilenceCheck[]` | Yes      | Every gate, in the order they are judged, so a console can say what it ruled out. A `configNotAdopted` fault appears here and is never the cause, because a station can air perfectly well while it is true         |

</details>
