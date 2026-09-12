---
'@deadair/api': patch
---

A plugin can now be imported from Settings → Plugins, as the tarball `npm pack` writes, with no shell on the box. It arrives switched off, as one copied in by hand does. Importing a newer version of an installed plugin replaces the old one and takes effect at once, with its settings kept; importing the same version again says the station needs a restart to run it. An installed plugin can also be removed from its page, which deletes its folder and keeps its settings.
