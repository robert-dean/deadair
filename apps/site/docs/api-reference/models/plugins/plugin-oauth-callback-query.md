---
title: 'PluginOAuthCallbackQuery'
sidebar_position: 25
mdx:
    format: 'md'
---

<details>
<summary>Attributes (5)</summary>

| Attribute | Type     | Required | Description                                                                                                                                                                                                                                                                                                                                        |
| --------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`    | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `state`   | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `error`   | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `ubi`     | `string` | No       |                                                                                                                                                                                                                                                                                                                                                    |
| `token`   | `string` | No       | What a desktop-style flow returns instead of `code`: the provider mints a token before the<br>consent screen and hands the same one back, which the plugin exchanges for a session. Last.fm's<br>auth works this way. Listed here because the route parses this query strictly, so an<br>undeclared parameter is a 400 before any plugin code runs |

</details>
