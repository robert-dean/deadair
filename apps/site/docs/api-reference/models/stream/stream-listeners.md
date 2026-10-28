---
title: 'StreamListeners'
sidebar_position: 6
mdx:
    format: 'md'
---

> Who is connected to the station's stream right now. Read on request and never stored

<details>
<summary>Attributes (4)</summary>

| Attribute     | Type                   | Required | Description                                                                                                                                                                                                                                      |
| ------------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readAt`      | `string`               | Yes      | When this was read                                                                                                                                                                                                                               |
| `total`       | `number`               | Yes      | The audience count the station is acting on, the same figure as the console's tally. It can differ from the number of connections: it is kept by a separate reading, and one HLS entry can stand for two players with the same address and agent |
| `connections` | `ListenerConnection[]` | Yes      | Every connection that could be read, Icecast mounts first in the station's mount order, then HLS, each longest-connected first                                                                                                                   |
| `unreadable`  | `UnreadableMount[]`    | Yes      | The mounts that could not be read. Empty when every one was. A mount listed here is not an empty mount                                                                                                                                           |

</details>
