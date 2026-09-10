---
title: 'TraceDecision'
sidebar_position: 15
mdx:
    format: 'md'
---

> One decision, folded: a job execution or a request

<details>
<summary>Attributes (7)</summary>

| Attribute | Type     | Required | Description                                                                                  |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------- |
| `id`      | `string` | Yes      | The job id or the request id. Already the station's correlation id, never generated for this |
| `kind`    | `string` | Yes      | A queue name, or a method and path                                                           |
| `parent`  | `string` | No       | The decision that enqueued this one. Absent on a request, a cron job and anything at boot    |
| `at`      | `string` | Yes      | When its first recorded call ended                                                           |
| `ms`      | `number` | Yes      | Wall clock, off the `job.run` span. Zero for a decision recorded before that span existed    |
| `calls`   | `number` | Yes      | Everything it did, not counting the `job.run` that contains them                             |
| `failed`  | `number` | Yes      | How many of those did not produce what they were asked for                                   |

</details>
