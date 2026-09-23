---
'@deadair/api': patch
'@deadair/web': patch
---

A piece of writing its source stops offering is withdrawn rather than read forever. Before this, when a narration plugin stopped listing a chapter (an operator marking a licence page or a contents page as not to be read, after the station had already seen the book), the station kept choosing it as next: it asked for the words, got none, gave up after three tries, and never read anything else in that book again. Now each refresh marks what the plugin no longer lists, the station passes over it, and the Narrations page shows it as Withdrawn with the date. Listing it again brings it back. A refresh withdraws nothing when a plugin lists nothing at all, since that is also what a plugin answers when it could not read the book today, or when it lists 200 pieces or more, since that may be only the first 200. A chapter already in the running order when it is withdrawn still airs.

The same pass also fixes a reading that finished being spoken after it stopped being the next one (a newer issue of a column arrived, or its band was removed): it is now collected and put away, where before it stayed in the list of unfinished productions, crowding out phone-ins.
