---
title: 'EnrollmentRequiredResponse'
sidebar_position: 20
mdx:
    format: 'md'
---

> Returned by /auth/step-up/start when no enrolled factor satisfies the requirement. The SPA should drive the user through enrollment and retry the gated action afterwards.

<details>
<summary>Attributes (1)</summary>

| Attribute | Type                    | Required | Description   |
| --------- | ----------------------- | -------- | ------------- |
| `result`  | `'enrollment_required'` | Yes      | Discriminator |

</details>
