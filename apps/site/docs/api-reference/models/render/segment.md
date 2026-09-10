---
title: 'Segment'
sidebar_position: 1
mdx:
    format: 'md'
---

> One thing the station can play that is not a record

<details>
<summary>Attributes (12)</summary>

| Attribute      | Type                                                                        | Required | Description                                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                                                                    | Yes      |                                                                                                                                                                                 |
| `kind`         | `string`                                                                    | Yes      | What sort of element it is: `ident`, `stinger`, `talkbreak`, `news`                                                                                                             |
| `state`        | `'planned' \| 'writing' \| 'written' \| 'rendering' \| 'ready' \| 'failed'` | Yes      | One state per stage of making it. Only `ready` can go on air; the station skips anything else rather than waiting for it                                                        |
| `label`        | `string`                                                                    | Yes      | What the console calls it, and what the mount is labelled with while it airs                                                                                                    |
| `source`       | `string`                                                                    | Yes      | Who made it: `library` for a file dropped into the inbox                                                                                                                        |
| `playable`     | `boolean`                                                                   | Yes      | Whether there is audio behind it yet                                                                                                                                            |
| `script`       | `string`                                                                    | No       | The words, for anything that speaks. Absent for an imported recording                                                                                                           |
| `spokenScript` | `string`                                                                    | No       | The words as the speech engine was handed them: symbols said, years read as a person reads them, the station's pronunciation list applied. Absent until something has spoken it |
| `sourcePath`   | `string`                                                                    | No       | The file in the inbox this came from. The bytes were copied, so emptying the inbox does not take it off the air                                                                 |
| `durationMs`   | `number`                                                                    | No       | How long it runs. A display value: the player measures the audio itself                                                                                                         |
| `error`        | `string`                                                                    | No       | Why it is `failed`                                                                                                                                                              |
| `voice`        | `string`                                                                    | No       | The station's own name for the voice this is said in, e.g. `host`. Absent means the speech plugin's default                                                                     |

</details>
