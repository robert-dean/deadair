---
'@deadair/api': patch
---

Stop refusing true weather figures: a range such as "3-5 degrees" is no longer read as -5, and "minus 5" or "5 below" now matches a reading of -5. An English break also has its sign held to the reading when it says it in words, so "minus 5" on a reading of 5 is refused. Outside English the word for minus is not read, so a figure with no sign in its digits matches either side of zero.
