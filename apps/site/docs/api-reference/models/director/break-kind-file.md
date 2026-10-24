---
title: 'BreakKindFile'
sidebar_position: 3
mdx:
    format: 'md'
---

> Kinds of break as a file, to move between stations. No id, no place in a list and no switch: a kind arrives switched off wherever it lands, so it is read back before it airs

<details>
<summary>Attributes (4)</summary>

| Attribute | Type                  | Required | Description                                                                             |
| --------- | --------------------- | -------- | --------------------------------------------------------------------------------------- |
| `format`  | `string`              | Yes      | What shape this is, so a file from a later build says so rather than being read wrongly |
| `takenAt` | `string`              | Yes      | When it was exported, ISO-8601                                                          |
| `station` | `string`              | No       | The station it was taken from. Provenance only                                          |
| `kinds`   | `BreakKindFileKind[]` | Yes      |                                                                                         |

</details>
