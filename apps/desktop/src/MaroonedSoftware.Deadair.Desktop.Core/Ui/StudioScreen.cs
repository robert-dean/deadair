namespace MaroonedSoftware.Deadair.Desktop.Core.Ui;

/// <summary>How the window is shown, as far as Studio cares. Avalonia's own enum, restated so Core needs no UI.</summary>
public enum WindowShape
{
    Normal,
    Minimized,
    Maximized,
    FullScreen,
}

/// <summary>
/// Whether Studio took the screen, and so whether it gives it back.
/// </summary>
/// <remarks>
/// <para>
/// Studio takes the window full screen when it opens, and leaving puts the window back as it was, but
/// ONLY if Studio was what made it full screen. A window that was already full screen stays so: putting
/// it back to a frame somebody never asked for would be Studio undoing their choice on the way out.
/// </para>
/// <para>
/// And if somebody leaves full screen themselves while Studio is up (the green button, ⌃⌘F), the
/// screen is theirs again: leaving Studio afterwards must not reach for a frame they have already
/// changed. <see cref="Moved"/> is told every change of shape and forgets on any that is not full screen.
/// </para>
/// </remarks>
public sealed class StudioScreen
{
    private WindowShape? _before;

    /// <summary>Whether Studio is holding the screen it took.</summary>
    public bool Took => _before is not null;

    /// <summary>Studio opening, with the window as it is now. Answers the shape to set, or null for none.</summary>
    public WindowShape? Enter(WindowShape now)
    {
        if (now is WindowShape.FullScreen)
        {
            _before = null;
            return null;
        }

        // A minimised window is not a frame to come back to, and a window cannot open Studio from the
        // Dock in any case; it comes back as an ordinary one.
        _before = now is WindowShape.Minimized ? WindowShape.Normal : now;
        return WindowShape.FullScreen;
    }

    /// <summary>Studio closing. Answers the shape to put back, or null to leave the window alone.</summary>
    public WindowShape? Leave(WindowShape now)
    {
        var before = _before;
        _before = null;
        return before is not null && now is WindowShape.FullScreen ? before : null;
    }

    /// <summary>The window changed shape, for whatever reason.</summary>
    public void Moved(WindowShape now)
    {
        if (now is not WindowShape.FullScreen)
        {
            _before = null;
        }
    }
}
