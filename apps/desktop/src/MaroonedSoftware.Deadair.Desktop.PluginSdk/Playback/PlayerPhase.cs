namespace MaroonedSoftware.Deadair.Desktop.PluginSdk.Playback;

/// <summary>
/// What the player is doing.
/// </summary>
/// <remarks>
/// There is no <c>Paused</c>, and its absence is the design. A live mount cannot be paused: holding
/// the connection open while nobody is listening still counts as an audience to the station's gate,
/// so a client that paused would keep an audience-gated station on air with an empty room. Stopping
/// drops the connection, which is the same conclusion <c>LivePlayer</c> reached on Android.
///
/// The numbers are shared with the native shim's <c>da_phase</c> and are matched by VALUE, so
/// reordering this enum silently changes what the player reports.
/// </remarks>
public enum PlayerPhase
{
    Stopped = 0,

    /// <summary>Asked to play; nothing has arrived yet.</summary>
    Opening = 1,

    /// <summary>Connected and filling. On an audience-gated station the first stretch of this is the
    /// station itself waking up, which is warm-up rather than a fault.</summary>
    Buffering = 2,

    Playing = 3,

    /// <summary>The stream went away. A live mount does not end on its own.</summary>
    Ended = 4,

    Failed = 5,
}
