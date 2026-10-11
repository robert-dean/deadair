namespace MaroonedSoftware.Deadair.Desktop.Core.Ui;

/// <summary>
/// Holding the display awake, and whether the machine is on mains power, as the operating system says.
/// </summary>
/// <remarks>
/// For Studio, which may be up all evening on a screen somebody is looking at rather than touching.
/// Asked on the UI thread; <see cref="Hold"/> is idempotent, so the caller says what it wants each
/// time it decides rather than tracking what it asked for last.
/// </remarks>
public interface IDisplayAwake : IDisposable
{
    /// <summary>Whether the machine is running on mains power rather than a battery.</summary>
    bool OnPower { get; }

    /// <summary>Hold the display awake, or let it sleep on its own timer again.</summary>
    void Hold(bool awake);
}

/// <summary>For a platform that cannot do either: always on power, and nothing held.</summary>
public sealed class NoDisplayAwake : IDisplayAwake
{
    public bool OnPower => true;

    public void Hold(bool awake)
    {
    }

    public void Dispose()
    {
    }
}
