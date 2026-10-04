---
title: 'VocalMarkersInput'
sidebar_position: 12
mdx:
    format: 'md'
---

> An operator's correction: either the record is instrumental, or the singing starts at `onsetMs`.

<details>
<summary>Attributes (3)</summary>

| Attribute      | Type      | Required | Description                                                                               |
| -------------- | --------- | -------- | ----------------------------------------------------------------------------------------- |
| `instrumental` | `boolean` | No       | Nobody sings on this record, whatever its lyrics say. _default: `false`_                  |
| `onsetMs`      | `number`  | No       | Where the first sung word lands, from the start of the file. Required unless instrumental |
| `endMs`        | `number`  | No       | Where the singing stops. Optional, and after the onset                                    |

</details>
