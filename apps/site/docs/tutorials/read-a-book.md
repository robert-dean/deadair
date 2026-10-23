---
title: Read a book on air
description: A chapter of a book every night at nine, read in the station's own voice, from an EPUB the station fetches and remembers its place in.
---

# Read a book on air

By the end of this page the station reads a chapter of *Frankenstein* every night at nine, in its own
voice, and picks up where it left off the next night. The presenter introduces each chapter, and
listeners' players show the chapter's title with the book's name beside it.

[Readings](../features/narrations.md) explains how the station reads, and when it declines to.

**You need** a station on air with a voice, and the **Analyzer** plugin enabled: a chapter is spoken
in several takes, and the analyzer joins them into one piece of audio. Without it the chapter never
airs, and the reason only shows on the Readings tab.

## 1. Install a plugin that reads books

Nothing bundled with the station provides text to read. This page uses **Vellichor books**, a
plugin from the [community directory](/community/plugins) that reads EPUB books from an address you
give it: Project Gutenberg, Standard Ebooks, a Calibre-Web server, or a file server of your own.

A community plugin is somebody else's code, and it runs with the station's own privileges once it is
on. Listed there does not mean reviewed, so install only what you trust. [Plugins](../features/plugins.md#plugins-are-trusted-code)
says more.

1. Download `deadair-plugin-vellichor-books-<version>.tgz` from the plugin's
   [releases page](https://github.com/VinewZ/deadair-vellichor-plugin/releases).
2. In the console, open **Plugins**, press **Import**, and choose the file.
3. Enable **Vellichor books**.

## 2. Give it a book

1. Open the plugin's settings.
2. Under **Books**, add a row: **Name** `Frankenstein`, and **EPUB address**
   `https://www.gutenberg.org/ebooks/84.epub3.images`.
3. Press **Test Connection**. It answers with the number of chapters it found. If it says the book is
   not cached yet, wait a minute and press it again.
4. Save.

Some books carry pages that are not chapters, such as a licence page, which would be read out like
one. Once the form is saved, reopen it and tick them under **Skipped sections**. Chapters keep their
numbers, so skipping one does not change the order.

Keep the shelf to a handful of books. The plugin stores each chapter separately, against a limit on
what a plugin may store.

## 3. Add the book as a series

The station looks at what its narration plugins offer twice an hour. To have it look now, open
**Library → Readings** and press **Look for new pieces**. *Frankenstein*'s chapters appear there in a
minute or two.

![Library, Readings, on a station with nothing to read yet, and the Look for new pieces button](/img/console/narrations.webp)
*Fig. 1. **Library → Readings** before any book has arrived.*

1. Open **Voice → Subjects** and find the **series** section.
2. Press **New series**.
3. Under **Series**, pick the book from the list.
4. Under **Name**, write what the presenter should call it on air: `Frankenstein, by Mary Shelley`.
5. Save.

## 4. Put it on the clock

1. Open **Programme → Today** and find **Format clock**.
2. Press **Add band**. In **New band**, after **Say a**, write `narration` as the **Sort of break**.
3. Under **How often**, choose **once a day at** and set **Time of day** to `21:00`.
4. Under **About**, pick the series you just made.
5. Save.

A `narration` band has to name a series. Without one it does nothing, because "the next piece of
anything" would read chapter four of one book and then chapter one of another.

## 5. What happens next

Six hours before nine, the station starts speaking the next chapter, at a lower priority than
everything the presenter needs. **Library → Readings** follows it from not read yet, through reading,
to ready to air.

At nine, the band takes the first gap between records. The presenter introduces the chapter, and the
station reads it whole. The station marks it read as it airs, so tomorrow is the next chapter. That
mark is its place in the book.

The reader is the station's **default host**, whoever is presenting at nine. A chapter is spoken
hours ahead, during whatever show is on then, so reading it in that show's voice would give each
chapter a different reader.

To hear a chapter before nine, press **Read it now** on it in **Library → Readings**. It still airs at
the band's time; this only speaks it sooner.

## With Claude

With Claude connected and allowed to **Read and manage**
([how](./connect-a-model.md#connect-claude-if-you-want-it-too)), Claude can do steps 3 and 4 once the
plugin has a book:

> Add Frankenstein from the narration plugin as a series called "Frankenstein, by Mary Shelley", and
> put a narration band on the format clock about it, once a day at nine in the evening. Show me what
> you will create first.

## If it goes wrong

- **The series list is empty.** The station has not looked yet. Press **Look for new pieces** on
  **Library → Readings**, and check that **Test Connection** in the plugin finds the book.
- **Nine o'clock came and went with no reading.** Open **Library → Readings** and look at the next
  chapter. It shows why: not spoken in time, a reading that failed (the station tries three times
  before it waits for you), or no analyzer to join the takes.
- **It read a licence page or a table of contents.** Tick it under **Skipped sections** in the
  plugin's settings.
- **The reading started a few minutes after nine.** A band waits for the record playing at its time
  to finish, so nothing is cut off.
- **You want to start the book again.** There is no way to rewind a series yet. Remove the series
  under **Voice → Subjects** and add it again.

## Next

- [Carry a podcast](./carry-a-podcast.md), for somebody else's audio rather than their text.
- [Readings](../features/narrations.md) for columns, which read the newest issue rather than the next
  chapter.
