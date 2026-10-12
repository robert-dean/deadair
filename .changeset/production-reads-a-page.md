---
'@deadair/api': minor
'@deadair/web': minor
'@deadair/sdk': minor
'@deadair/plugin-sdk': minor
'@deadair/plugin-rss': minor
---

A production can be made from a web page. Give a source an address instead of pasted text, or give an episode of one of your own shows a page to read first, and the station reads the page before writing anything and states only what it finds there. The page is read by the RSS plugin, under the same permission to open the web it already asks for to read the stories behind headlines, so that permission now also covers pages you name; a page it cannot read fails the production with the site's name. For plugin authors, a `news` plugin may implement the optional `readPage(url)`, and `readDocument` and `extractTitle` in the SDK read a whole page and the title it gives itself.
