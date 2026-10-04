---
title: 'VocalMarkersDetail'
sidebar_position: 11
mdx:
    format: 'md'
---

> Where the singing starts and stops on one record, and which answer that is. Times are milliseconds
> from the start of the file, the timeline a lyric's timings use. Never the words themselves.

<details>
<summary>Attributes (5)</summary>

| Attribute | Type                                      | Required | Description                                                                  |
| --------- | ----------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `trackId` | `string`                                  | Yes      | _read-only_                                                                  |
| `kind`    | `'instrumental' \| 'ranges' \| 'unknown'` | Yes      | Nobody sings on it; where the singing is; or nothing to go on. _read-only_   |
| `onsetMs` | `number`                                  | No       | Where the first sung word lands, when kind is ranges. _read-only_            |
| `endMs`   | `number`                                  | No       | Where the singing stops, when it is known. _read-only_                       |
| `source`  | `'override' \| 'lyrics' \| 'none'`        | Yes      | An operator's correction, the record's timed lyrics, or neither. _read-only_ |

</details>
