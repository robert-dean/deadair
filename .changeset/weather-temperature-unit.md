---
'@deadair/api': patch
---

On a station that broadcasts in a language other than English, the weather break now says every temperature with its unit. The model was handed bare figures with the unit named once, and in German it copied them bare: "Es sind -5." and "a high of minus two" with no "Grad". English stations are unchanged.
