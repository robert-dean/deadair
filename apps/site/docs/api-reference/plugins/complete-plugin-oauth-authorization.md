---
title: 'Complete plugin oauth authorization'
sidebar_label: 'Complete plugin oauth authorization'
sidebar_position: 18
mdx:
    format: 'md'
---

Completes the flow. Anonymous: the provider redirects the browser here with no session of ours

**`GET`** `/plugins/{id}/oauth/callback`

:::note
SDK method: `completePluginOAuthAuthorization`
Security: public
:::

## Attributes

<details>
<summary>Attributes (6)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | `string` | Yes      | Path parameter.                                                                                                                                                                                                                                                                                                                                    |
| `code`    | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `error`   | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `state`   | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `token`   | `string` | No       | What a desktop-style flow returns instead of `code`: the provider mints a token before the<br>consent screen and hands the same one back, which the plugin exchanges for a session. Last.fm's<br>auth works this way. Listed here because the route parses this query strictly, so an<br>undeclared parameter is a 400 before any plugin code runs |
| `ubi`     | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |

</details>

## Response

`200 OK` — Returns a [PluginOAuthResult](../models/plugins/plugin-oauth-result.md) object.
