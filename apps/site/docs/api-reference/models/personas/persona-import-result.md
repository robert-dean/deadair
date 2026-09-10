---
title: 'PersonaImportResult'
sidebar_position: 22
mdx:
    format: 'md'
---

> What importing actually did, with the plan it did it from.
>
> All or nothing: a file whose import failed part-way leaves the station exactly as it was, on
> `PUT /settings`' own rule. The preview is what stands between an operator and a surprise, so a
> partial landing would be the one outcome nothing had described

<details>
<summary>Attributes (6)</summary>

| Attribute        | Type                | Required | Description                                                                                                                                          |
| ---------------- | ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan`           | `PersonaImportPlan` | Yes      | What it decided to do, notices and all, so the answer carries its own explanation. _read-only_                                                       |
| `created`        | `number`            | Yes      | _read-only_                                                                                                                                          |
| `updated`        | `number`            | Yes      | Characters whose sheet was rewritten. An update replaces the sheet and ADDS stories; it never deletes one the operator here wrote. _read-only_       |
| `storiesWritten` | `number`            | Yes      | _read-only_                                                                                                                                          |
| `detailsWritten` | `number`            | Yes      | _read-only_                                                                                                                                          |
| `personas`       | `PersonaList`       | Yes      | The roster as it now stands, on this file's own rule: every mutation answers the whole list, because more than the named row can change. _read-only_ |

</details>
