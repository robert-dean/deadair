---
'@deadair/api': minor
'@deadair/sdk': minor
'@deadair/web': patch
'@deadair/desktop': patch
---

A schedule slot can name the festival it is built around (`festivalId`), and a broadcast put on air can name one too. The festival rides the show's rules, so applying a slot that gained or lost one changes the show on air, and a festival that is removed clears the slots naming it. A schedule file never carries one. The web console and the desktop app keep a slot's festival when they save it.
