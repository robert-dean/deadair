---
'@deadair/api': minor
'@deadair/plugin-sdk': patch
---

One page for every job more than one plugin can do

Installing a second plugin that speaks, writes, or says who sounds like whom
raises a question the console never asked out loud: which one does the station
actually use. The answer was spread across four settings sections, in the
section that owned the FEATURE rather than the one that owned the question, as
a text box holding a raw plugin id. Most capabilities had no answer at all.

**Settings → Providers** is now that page. Each job the station can do more
than one way is a block: who can do it, which one is doing it, and for the jobs
where order matters, the order they are asked in — drawn as the plugins
themselves, by name, in the order the station is really using, so moving one is
one click rather than rebuilding the default from an empty table first. A job
only one plugin can do says so instead of offering a choice that is not one.

Three capabilities gained an order they did not have:

- **The weather.** Services are asked in turn and the first reading wins, so
  this decides whose forecast is read out. It was alphabetical by plugin id.
- **Charts.** Sets the order of the menu, and decides outright which service
  answers a chart asked for by style.
- **What the station believes about a record.** Sources are merged field by
  field and the first non-empty answer wins, so this decides who is believed
  about a year or a label. Each plugin still declares how much to trust it,
  which is what orders anything you have not listed; the setting is how you
  overrule that with what you can see on your own library. It changes what is
  looked up next rather than what is already stored.

In every case an empty setting is exactly what the station did before, and
listing a plugin never enables it: anything unlisted is asked after the ones
that are, and an id nothing answers to is ignored rather than fatal.

Two things that were invisible are now said out loud. A plugin **named** for a
job and not running means the station is doing that job with nothing at all,
because naming one is an instruction and never falls back; the page says so in
red, and so does the plugin's own page. And every plugin card now says where it
stands — "asked 2nd of 3 for who sounds like whom", "in use for speaking" —
linking to the block that decides it, so the choice is visible from where you
are standing when you make it.

Nothing stored moves: the existing keys keep their names, and Rotation, Voice
and audio, Words and Measurement each keep a line pointing at where their
setting went.
