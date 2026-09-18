---
title: Listing your plugin
sidebar_position: 7
description: How to put a plugin you wrote in the community directory, what the listing says, and what it does not.
---

A plugin that works on your station can be listed in the [community directory](/community/plugins), where operators looking for a
music source, a voice or a place facts come from will find it. A listing is a description and a pointer: the directory never hosts
the plugin, never runs it, and never installs it anywhere.

## What you need first

- **Public source.** A listing links to it, and a plugin nobody can read is not one anybody should install.
- **A tarball, if you want one-step installs.** What `npm pack` writes (see [packaging](./packaging.md)), at an https address that
  ends in `.tgz`: a GitHub release asset, or the npm registry if you publish there. The listing shows its SHA-256 beside the link,
  so an operator can check the file they upload is the one that was listed. Without a tarball, the listing says to build it from
  source.
- **An id of your own.** Ids under `deadair.` belong to the plugins that ship with the station, and the console refuses to import
  one.

## Listing it

Open [the form](https://github.com/robert-dean/deadair-community/issues/new?template=add-plugin.yml) and copy what it asks for from
your manifest: the id, the name, the capabilities, the hosts in its network permissions, and the `apiVersion` range. A bot turns the
issue into a pull request, or comments with what has to change. When you give a tarball, it downloads it once to take the checksum
and to check that its `package.json` names a plugin entry and the version you gave; it never runs it. A maintainer reads the
listing and merges it.

To publish a new version, edit the issue with the new version and tarball, and the pull request follows.

## What a listing does not say

**That anybody reviewed the code.** Nobody does, and the directory says so above every plugin on it. What a card says a plugin talks
to is your manifest's description of a well-behaved plugin, not a limit on what it can do, for the reasons in
[trusted code](./index.md#a-plugin-is-trusted-code-and-nothing-about-that-is-going-to-change). Write the description as what the plugin
does for a station, and leave safety claims out of it.
