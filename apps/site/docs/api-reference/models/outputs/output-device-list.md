---
title: 'OutputDeviceList'
sidebar_position: 4
mdx:
    format: 'md'
---

> Every speaker every `output` plugin can play the station on

<details>
<summary>Attributes (3)</summary>

| Attribute              | Type              | Required | Description                                                                                                                                                                                                      |
| ---------------------- | ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devices`              | `OutputDevice[]`  | Yes      |                                                                                                                                                                                                                  |
| `problems`             | `OutputProblem[]` | Yes      | Plugins that did not answer. Their speakers are missing from `devices` rather than the whole list failing                                                                                                        |
| `discoverySeesNothing` | `boolean`         | Yes      | True when the station has looked for speakers on its network and never found one, which on a container usually means its network cannot carry multicast (a bridge network). Speakers added by address still work |

</details>
