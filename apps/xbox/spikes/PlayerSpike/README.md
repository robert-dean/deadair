# Xbox player spike

The go/no-go for an Xbox listener. Nothing else in `apps/xbox` gets written until it has run on a
real console, because the whole design depends on four things that only the console can answer:

1. **Does modern .NET run on Xbox at all?** UWP on .NET 9 and later is generally available on Windows.
   Microsoft has said nothing either way about the console. If it does not run, the fallback is a
   thin native UWP host owning the audio, with a WebView2 UI, and the plan changes before phase 1.
2. **Does the generated SDK decode under Native AOT?** AOT is the only way a modern .NET UWP app is
   accepted by the Store. The SDK uses reflection-based System.Text.Json, which AOT turns off by
   default. The spike decodes `GET /nowplaying` through the SDK and, if that fails, again by hand,
   so one run says whether the station or the SDK is the problem.
3. **Does the audio survive a game?** An app in the background gets 128MB, not about 1GB, and is
   terminated if it goes over. The spike logs memory every five seconds and every limit change, and
   it can drop its page on the way into the background to see what that saves.
4. **How quickly does each mount start, and what does the station see?** The desktop measured MP3 at
   about five seconds and HLS at well under two. `MediaSource.CreateFromUri` cannot set a User-Agent,
   so the MP3 connection's agent is whatever Windows sends. Read it from the station's side.

## Running it

On the Windows PC, with Visual Studio 2026 and the "Windows application development" workload plus
its optional "Universal Windows Platform tools" and Windows 11 SDK (10.0.26100):

1. **Put the console in Dev Mode.** Install "Xbox Dev Mode" from the Store on the console, take the
   code it shows to Partner Center, and restart into Dev Mode. Dev Home shows the console's IP.
2. **Open `PlayerSpike.csproj`**, set the platform to x64 and the target to Remote Machine with that
   IP (Authentication: Universal (Unencrypted Protocol)). The first deploy asks for the PIN from Dev
   Home's "Pair with Visual Studio".
3. **Run it twice: Debug, then Release.** Debug runs on the JIT and Release is Native AOT, and only the
   second is what the Store would get. The first block of the log says which one is running.

If the project does not load or build, the SDK has probably moved on from these property names.
Create a fresh "Blank UWP App (.NET)" from Visual Studio's template, copy its `PropertyGroup` over
this one, and keep `Platforms`, `RuntimeIdentifiers` and the SDK reference.

## The runs

For each build, Debug and Release:

1. Type the station's address, press **Read station**.
2. **Play MP3.** Wait for `FIRST PLAYING`. Then press the Xbox button and launch any game.
3. Listen for two minutes in the game. Come back. Press **Stop**, or pause with the guide's media
   controls, and check the station drops the listener.
4. Same again with **Play HLS**.
5. Once with the page-drop box unticked, to see the difference it makes.

The log is on screen and in the app's `LocalState\spike.log`. Device Portal (the console's IP on port
11443) reaches it through File explorer.

## What to bring back

| Reading | Debug | Release (AOT) |
| --- | --- | --- |
| `device family` and `framework` lines | | |
| `sdk decode` OK or FAILED, with the message | | |
| MP3 first playing after (s) | | |
| HLS first playing after (s) | | |
| Audio kept playing in a game? (MP3 / HLS) | | |
| Peak memory in background, page dropped | | |
| Peak memory in background, page kept | | |
| Any `SUSPENDING` or `limit changing` lines | | |
| Remote/guide pause dropped the connection? | | |
| Agent the station logged for the MP3 connection | | |

Plus the build output's trim and AOT warnings for the Release build, if there were any.
