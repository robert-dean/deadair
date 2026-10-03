---
title: 'OutputCast'
sidebar_position: 5
mdx:
    format: 'md'
---

> A speaker the station is meant to be playing on, and how it is doing

<details>
<summary>Attributes (7)</summary>

| Attribute    | Type                                                                            | Required | Description                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pluginId`   | `string`                                                                        | Yes      |                                                                                                                                                                                                                                                         |
| `deviceId`   | `string`                                                                        | Yes      |                                                                                                                                                                                                                                                         |
| `deviceName` | `string`                                                                        | Yes      | What the speaker was called when the cast started                                                                                                                                                                                                       |
| `mountPath`  | `string`                                                                        | Yes      | Which mount it plays                                                                                                                                                                                                                                    |
| `startedAt`  | `string`                                                                        | Yes      |                                                                                                                                                                                                                                                         |
| `phase`      | `'idle' \| 'opening' \| 'buffering' \| 'playing' \| 'stopped' \| 'unreachable'` | Yes      | As the speaker reports it now. `opening` and `buffering` are a stream starting, not a failure; `stopped` with the station's stream still loaded is played again on its own; `unreachable` is a speaker that did not answer, which the station waits out |
| `detail`     | `string`                                                                        | No       | A sentence about the phase when it needs one, such as why a speaker is unreachable                                                                                                                                                                      |

</details>
