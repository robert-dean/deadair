---
'@deadair/api': minor
'@deadair/sdk': minor
---

The station now keeps track of what it has been given to read out. A narration plugin says what series it offers (a book, a column, a queue of long reads), and the station remembers every piece of each, in the order that series is worked through: a book from its first chapter, a column from its newest issue. It re-reads the list twice an hour, and the Clock can point a `narration` band at one of them. Nothing is spoken or aired yet; that follows.
