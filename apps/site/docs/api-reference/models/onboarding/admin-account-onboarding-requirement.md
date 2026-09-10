---
title: 'AdminAccountOnboardingRequirement'
sidebar_position: 3
mdx:
    format: 'md'
---

Extends [`CoreOnboardingRequirement`](./core-onboarding-requirement.md)

<details>
<summary>Attributes (2)</summary>

| Attribute | Type                                  | Required | Description  |
| --------- | ------------------------------------- | -------- | ------------ |
| `key`     | `'admin.account'`                     | Yes      |              |
| `value`   | `{ email: string; password: string }` | Yes      | _write-only_ |

</details>
