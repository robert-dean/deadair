---
title: 'Topic'
sidebar_position: 1
mdx:
    format: 'md'
---

> What a break can be about: a news category, and later a weather location. The operator's own vocabulary, per sort of break

<details>
<summary>Attributes (6)</summary>

| Attribute  | Type                      | Required | Description                                                                                                            |
| ---------- | ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`       | `string`                  | Yes      | _read-only_                                                                                                            |
| `kind`     | `string`                  | Yes      | Which sort of break this is a subject for, as `segments.kind` spells it                                                |
| `key`      | `string`                  | Yes      | A stable slug, unique within its kind. What the format clock points a band at and what a seeded topic is recognised by |
| `label`    | `string`                  | Yes      | What a break calls it out loud, so it is the phrasing you would want to hear                                           |
| `config`   | `Record<string, unknown>` | Yes      | This sort of break's own settings for this subject, in the fields its kind declares. Nothing generic reads them        |
| `position` | `number`                  | Yes      | Your own order, for the list. Two subjects never contest anything, so it means nothing else                            |

</details>
