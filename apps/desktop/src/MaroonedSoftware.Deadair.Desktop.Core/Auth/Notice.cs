using MaroonedSoftware.Deadair.Desktop.Core.Text;

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

    /// <summary>The station's answer to something that worked, which is itself what needs reading.</summary>
    /// <remarks>
    /// Not a refusal, so it carries its own tone rather than the fault colour every other notice is
    /// drawn in: a request for the news that was taken, or one the station declined for a reason it gave.
    /// </remarks>
    public sealed record Said(string Detail, StatusTone Tone) : Notice;

    /// <summary>The sentence a notice is shown as.</summary>
    /// <remarks>
    /// One wording for every surface that shows one, so a refusal reads the same in a dialog as it
    /// does at the foot of a page.
    /// </remarks>
    public static string Describe(Notice notice) => notice switch
    {
        NoLongerOperator => "This account is no longer an operator.",
        StepUpNeeded => "The station wants your authenticator code again before that.",
        Expected expected => expected.Detail,
        Failed failed => failed.Detail,
        Said said => said.Detail,
        _ => "Something went wrong.",
    };

    /// <summary>What colour a notice is drawn in. Everything but <see cref="Said"/> is something refused.</summary>
    public static StatusTone ToneOf(Notice notice) => notice is Said said ? said.Tone : StatusTone.Fault;
}
