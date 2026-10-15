---
'@deadair/api': patch
---

Mail: the invitation email is written in markdown and rendered by a locked-down renderer. Raw HTML in it shows as text, it has no images, and its links can go only to `https`, `http` or `mailto` addresses. The wording is unchanged. The plain-text version now puts the link's address after "Make your account" instead of on a line by itself. This is groundwork for letting a station write its own invitation.
