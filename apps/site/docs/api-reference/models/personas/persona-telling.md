---
title: 'PersonaTelling'
sidebar_position: 36
mdx:
    format: 'md'
---

> One time a character actually told one of its own stories. What the timeline lists, and what a
> rollback is chosen from: the moment on each row is the exact string the station compares against,
> not a rounding of it

<details>
<summary>Attributes (10)</summary>

| Attribute   | Type                                    | Required | Description                                                                                                               |
| ----------- | --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`                                | Yes      | _read-only_                                                                                                               |
| `storyId`   | `string`                                | Yes      | _read-only_                                                                                                               |
| `title`     | `string`                                | Yes      | The handle of the story this told, so a timeline reads as something rather than as ids. _read-only_                       |
| `source`    | `'break' \| 'production' \| 'backfill'` | Yes      | What wrote it. `backfill` is the rows migration 0034 reconstructed from the two columns it replaced. _read-only_          |
| `mode`      | `'offered' \| 'told'`                   | Yes      | Whether the story was handed over as something the writer MAY use, or as the thing the break was for. _read-only_         |
| `told`      | `boolean`                               | Yes      | Whether it actually went out, as the WRITER read its own answer back. An offered story may simply be ignored. _read-only_ |
| `said`      | `string`                                | No       | The words that carried it, kept here because the script history they came from is swept nightly. _read-only_              |
| `segmentId` | `string`                                | No       | The break that carried it, while that row still exists. _read-only_                                                       |
| `airedAt`   | `string`                                | No       | When a listener could first have heard it. Absent means written but not yet aired, or never aired at all. _read-only_     |
| `at`        | `string`                                | Yes      | When it was written. Hand this back as `to` to roll back to just before it. _read-only_                                   |

</details>
