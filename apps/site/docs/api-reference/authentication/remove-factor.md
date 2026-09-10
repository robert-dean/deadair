---
title: 'Remove factor'
sidebar_label: 'Remove factor'
sidebar_position: 10
mdx:
    format: 'md'
---

Remove one of the caller's own factors. Answered only for `authenticator` today, and only after a recent strong-factor verification: the same gate enrolment sits behind once a strong factor exists, so a stolen session cannot quietly switch the second factor off. Removing the last authenticator turns the sign-in challenge off for that account.

**`DELETE`** `/auth/factors/{method}/{methodId}`

:::note
SDK method: `removeFactor`
Security: authenticated (policy: none)
:::

## Attributes

<details>
<summary>Attributes (2)</summary>

| Attribute  | Type                         | Required | Description     |
| ---------- | ---------------------------- | -------- | --------------- |
| `method`   | `AuthenticationFactorMethod` | Yes      | Path parameter. |
| `methodId` | `string`                     | Yes      | Path parameter. |

</details>

## Response

`204 No Content`
