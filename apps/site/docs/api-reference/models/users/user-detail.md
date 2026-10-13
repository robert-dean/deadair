---
title: 'UserDetail'
sidebar_position: 21
mdx:
    format: 'md'
---

> A person, with how they sign in and where they are signed in

Extends [`UserSummary`](./user-summary.md)

<details>
<summary>Attributes (3)</summary>

| Attribute  | Type           | Required | Description                              |
| ---------- | -------------- | -------- | ---------------------------------------- |
| `factors`  | `UserFactor[]` | Yes      | Every way they can sign in               |
| `sessions` | `Session[]`    | Yes      | Where they are signed in now             |
| `signIns`  | `UserSignIn[]` | Yes      | Their most recent sign-ins, newest first |

</details>
