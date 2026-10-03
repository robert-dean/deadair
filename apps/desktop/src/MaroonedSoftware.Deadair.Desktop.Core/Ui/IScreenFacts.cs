namespace MaroonedSoftware.Deadair.Desktop.Core.Ui;

/// <summary>
/// What the operating system says about how the app's window is being seen.
/// </summary>
/// <remarks>
/// For Studio, whose backdrop moves for as long as it is up and may be up all evening: it holds still
/// for somebody who has asked their Mac for less motion, and stops drawing while nothing of the window
/// can be seen.
/// </remarks>
public interface IScreenFacts
{
    /// <summary>Whether the person has asked for less motion (System Settings › Accessibility › Display).</summary>
    bool ReduceMotion { get; }

    /// <summary>Whether any of <paramref name="window"/> can be seen, or null when the platform cannot say.</summary>
    /// <param name="window">The platform's own window, as the UI toolkit hands it over.</param>
    bool? IsSeen(nint window);
}

/// <summary>For a platform that cannot say: full motion, and always seen.</summary>
public sealed class NoScreenFacts : IScreenFacts
{
    public bool ReduceMotion => false;

    public bool? IsSeen(nint window) => null;
}
