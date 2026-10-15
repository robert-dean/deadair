---
'@deadair/api': minor
---

Mail: a station can write its own invitation email. Settings → Mail has two new fields: "Invitation subject" and "Invitation message". The message is written in markdown and can use `{{station}}`, `{{role}}`, `{{inviter}}`, `{{link}}`, `{{until}}`, `{{androidApp}}`, `{{iosApp}}` and `{{guide}}`. A message is refused when it is saved if:

- it leaves out `{{link}}`
- it names a placeholder that doesn't exist
- it uses a placeholder as a link that isn't an address
- its link shares a line that can be left out

A paragraph or list item whose placeholder has nothing to fill it is left out, so a line about the iPhone app appears once it is in the App Store. Leaving either field empty keeps the station's own wording. A stored message that cannot be used (one seeded by hand, say) is replaced by the station's own, and the log says why.
