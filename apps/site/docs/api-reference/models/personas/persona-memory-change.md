---
title: 'PersonaMemoryChange'
sidebar_position: 38
mdx:
    format: 'md'
---

> What a rollback would undo, or did. Counted with the same predicates the delete uses, so a preview
> cannot promise one thing and do another

<details>
<summary>Attributes (6)</summary>

| Attribute  | Type     | Required | Description                                                                                                                            |
| ---------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tellings` | `number` | Yes      | Tellings forgotten. Every one, whatever wrote it: a telling is a record of something the station did rather than a claim somebody made |
| `notes`    | `number` | Yes      | Notes the distil pass wrote. Nothing an operator typed is ever counted here or deleted                                                 |
| `stories`  | `number` | Yes      | Stories the enrichment pass proposed                                                                                                   |
| `details`  | `number` | Yes      | Details it proposed. A floor rather than a total: a story that is itself going takes every detail hung on it                           |
| `rejected` | `number` | Yes      | How many of the above were proposals somebody turned down. Deleting one lets the nightly pass offer it again                           |
| `touched`  | `number` | Yes      | How many the operator had since accepted or edited. They still go, and this is the one loss they did not cause                         |

</details>
