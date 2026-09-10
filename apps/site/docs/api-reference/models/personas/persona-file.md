---
title: 'PersonaFile'
sidebar_position: 16
mdx:
    format: 'md'
---

> A character as a file: everything somebody would have to send to put this presenter on another
> station, and nothing that belongs to the station it came from

<details>
<summary>Attributes (4)</summary>

| Attribute  | Type                   | Required | Description                                                                                                                                                                                |
| ---------- | ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`   | `string`               | Yes      | What shape this is, so a file from a later build says so rather than being read wrongly. The shapes below are what an import actually validates; this is for the human reading the failure |
| `takenAt`  | `string`               | Yes      | When it was exported, ISO-8601                                                                                                                                                             |
| `station`  | `string`               | No       | The station it was taken from. Provenance only: an import writes into whichever station it is running as, and the two need not match                                                       |
| `personas` | `PersonaFilePersona[]` | Yes      |                                                                                                                                                                                            |

</details>
