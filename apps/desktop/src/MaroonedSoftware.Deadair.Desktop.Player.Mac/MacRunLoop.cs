namespace MaroonedSoftware.Deadair.Desktop.Player.Mac;

/// <summary>
/// Runs the calling thread's run loop, for a host that does not have one.
/// </summary>
/// <remarks>
/// <b>An Avalonia application must never call this.</b> It already runs one, and pumping a second
/// from inside it is how a UI stops responding.
///
/// It exists because a console host has no run loop at all, and AVFoundation drives its state
/// machine on one — so a player in a plain command-line tool opens, reports buffering, and then sits
/// there forever with no audio and no error. That looked exactly like a broken player the first time
/// it was measured, and it is not: it is a host that never let the player work.
/// </remarks>
public static class MacRunLoop
{
    public static void Pump(TimeSpan duration) => NativePlayer.Pump(duration.TotalSeconds);
}
