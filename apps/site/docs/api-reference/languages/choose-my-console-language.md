---
title: 'Choose my console language'
sidebar_label: 'Choose my console language'
sidebar_position: 2
mdx:
    format: 'md'
---

Chooses the language your console is shown in, or, without one, goes back to following the browser

**`PUT`** `/console/language`

:::note
SDK method: `chooseMyConsoleLanguage`
Security: authenticated (policy: none)
:::

## Request body (`application/json`)

Accepts a [ConsoleLanguageChoice](../models/languages/console-language-choice.md) object.

## Response

`200 OK` — Returns a [ConsoleLanguageChoice](../models/languages/console-language-choice.md) object.
