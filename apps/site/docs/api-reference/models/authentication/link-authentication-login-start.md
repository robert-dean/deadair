---
title: 'LinkAuthenticationLoginStart'
sidebar_position: 31
mdx:
    format: 'md'
---

Extends [`BaseAuthenticationLoginStartWithEmail`](./base-authentication-login-start-with-email.md)

<details>
<summary>Attributes (2)</summary>

| Attribute    | Type                  | Required | Description                                                                                                                                                                                 |
| ------------ | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grant_type` | `'link'`              | Yes      | The grant type for the request                                                                                                                                                              |
| `purpose`    | `'signin' \| 'reset'` | No       | What the link is for. `reset` words the email as a password reset and lands the person on the password form once signed in; the link and what it proves are the same. Absent means `signin` |

</details>
