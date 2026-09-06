package com.maroonedsoftware.deadair.ui.theme

import androidx.compose.material3.Typography

/**
 * The type scale, and which role each level plays here.
 *
 * Material's own scale, unchanged. What this file fixes is the MAP, because before it existed one
 * style was doing three jobs: `titleMedium` was a section header on Settings, a screen heading on
 * the signed-out placeholder and a card title on What's on, and the three screens looked as if
 * they came from three apps.
 *
 * | Role                                        | Style            |
 * |---------------------------------------------|------------------|
 * | the app bar's title                         | `titleLarge`     |
 * | a screen's own heading (a placeholder's)    | `headlineSmall`  |
 * | the record on air                           | `headlineSmall`  |
 * | a section header inside a form              | `titleMedium`    |
 * | a card's title, a row's headline            | `titleMedium`    |
 * | body copy, a row's primary line             | `bodyLarge`      |
 * | secondary copy under a heading              | `bodyMedium`     |
 * | a note, a banner, a footer line             | `bodySmall`      |
 * | metadata beside a row (a time, a count)     | `labelMedium`    |
 * | an eyebrow over a card                      | `labelSmall`     |
 */
val AppTypography: Typography = Typography()
