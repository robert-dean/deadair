namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>
/// Something the operator should be told, once, in passing.
/// </summary>
/// <remarks>
/// Raised as an event and drawn by one host rather than thrown at a call site, so that every manage
/// action reports the same way and no screen invents its own error surface.
/// </remarks>
public abstract record Notice
{
    private Notice()
    {
    }

    /// <summary>The station refused because this account no longer holds the permission.</summary>
    /// <remarks>
    /// Roles are re-read when this happens, so the controls disappear rather than staying and failing.
    /// </remarks>
    public sealed record NoLongerOperator : Notice;

    /// <summary>The station wants a second factor before it will do this.</summary>
    public sealed record StepUpNeeded : Notice;

    /// <summary>An outcome the caller expected and named, such as "there is nothing to resume".</summary>
    public sealed record Expected(string Detail) : Notice;

    /// <summary>Anything else, with the station's own sentence where it sent one.</summary>
    public sealed record Failed(string Detail) : Notice;
}
