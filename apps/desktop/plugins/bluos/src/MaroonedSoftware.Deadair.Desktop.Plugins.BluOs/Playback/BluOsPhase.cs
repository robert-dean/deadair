using MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Plugins.BluOs.Playback;

/// <summary>Whether what a player is playing is the station this app asked it to play.</summary>
public enum StreamMatch
{
    /// <summary>Our mount.</summary>
    Ours,

    /// <summary>Something else. Somebody put a record on, or switched to another radio station.</summary>
    Other,

    /// <summary>The player did not say.</summary>
    Absent,
}

/// <summary>
/// What a BluOS state means to somebody listening to this station.
/// </summary>
/// <remarks>
/// <para>
/// Pure, so the whole mapping can be read and tested as a table without a player on the network. The
/// host decides what to DO about a phase — whether a failure is warm-up, when to try again — so
/// everything here is about reporting honestly and nothing is about recovery.
/// </para>
/// <para>
/// <b>Nothing here ever answers Failed.</b> A state this app has not seen before is a state, not a
/// fault: the spec's own list of them ends in "etc.", so refusing to recognise a word would turn a
/// firmware update into a broken player. The only fault a plugin can actually observe is its own
/// requests going unanswered, and that is the watcher's to report.
/// </para>
/// </remarks>
public static class BluOsPhase
{
    /// <summary>
    /// Whether the player's <c>streamUrl</c> names our mount.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The spec says to treat <c>streamUrl</c> as opaque and to read only whether it is there. This
    /// does the one thing it says not to, and the reason is that there is no other way to tell a
    /// player streaming OUR station from one somebody switched to a different station in the next
    /// room. Without it, "playing" would mean "playing something".
    /// </para>
    /// <para>
    /// A station added to the player by hand is filed under a service and its URL carries a prefix,
    /// which is why this looks for the mount inside the value rather than comparing the whole thing.
    /// </para>
    /// </remarks>
    public static StreamMatch Match(string? streamUrl, Uri mount)
    {
        ArgumentNullException.ThrowIfNull(mount);

        if (string.IsNullOrWhiteSpace(streamUrl))
        {
            return StreamMatch.Absent;
        }

        return streamUrl.Contains(mount.ToString(), StringComparison.OrdinalIgnoreCase)
            ? StreamMatch.Ours
            : StreamMatch.Other;
    }

    /// <summary>
    /// One reading, turned into what a listener should be told.
    /// </summary>
    /// <param name="state">The player's own word, whatever it is.</param>
    /// <param name="secs">How far in, when it said.</param>
    /// <param name="match">Whether what it is playing is ours.</param>
    public static PlayerStatus From(string? state, int? secs, StreamMatch match)
    {
        var word = state?.Trim().ToLowerInvariant();

        // Somebody put something else on. From this app's seat the player is gone, whatever it says
        // it is doing, and saying anything else would draw a transport that controls nothing.
        if (match == StreamMatch.Other)
        {
            return new PlayerStatus(PlayerPhase.Stopped, $"the player is on another source ({word ?? "unknown"})");
        }

        return word switch
        {
            "stop" => PlayerStatus.Stopped,

            // There is no Paused phase, deliberately, and this is where that decision is felt. A
            // paused player still holds the connection and is still an audience, so the honest
            // report is that we are not listening; the conductor's answer to a stop it did not ask
            // for is to start again, which is what somebody who pressed play wants.
            //
            // The detail does not say somebody paused it, because measurement says that is often
            // not what happened: when the station's stream died under the M10 it went to `pause`
            // with its position frozen, not to `stop`. So `pause` covers both a hand on a remote and
            // a stream that stopped arriving, and the two are indistinguishable from here.
            "pause" => new PlayerStatus(PlayerPhase.Stopped, "the player is not playing it (paused, or the stream stopped arriving)"),

            "connecting" => new PlayerStatus(PlayerPhase.Opening),

            // Connected, nothing heard yet. On an audience-gated station this is the station itself
            // waking up, and it is warm-up rather than a fault.
            "stream" or "play" when secs is null or 0 => new PlayerStatus(PlayerPhase.Buffering),

            "stream" or "play" => match == StreamMatch.Absent
                ? new PlayerStatus(PlayerPhase.Playing, "the player did not say what it is playing")
                : new PlayerStatus(PlayerPhase.Playing),

            null or "" => new PlayerStatus(PlayerPhase.Opening, "the player did not say what it is doing"),

            // The spec's list ends in "etc.". A word nobody here has seen is a player doing
            // something, and calling it a failure would make a firmware update look like a fault.
            _ => new PlayerStatus(PlayerPhase.Opening, $"the player says {word}"),
        };
    }
}
