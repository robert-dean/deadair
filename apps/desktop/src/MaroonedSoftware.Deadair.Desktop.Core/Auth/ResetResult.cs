namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>What the station said to "Forgot your password?". The Android app's <c>ResetResult</c>.</summary>
/// <remarks>
/// <see cref="Sent"/> is the same answer whether or not the address has an account, because the
/// station gives the same answer either way: it will not say who has an account, so neither can this
/// app.
/// </remarks>
public abstract record ResetResult
{
    private ResetResult()
    {
    }

    /// <summary>The station took the request. A link is on its way if the address has an account.</summary>
    public sealed record Sent : ResetResult;

    /// <summary>The address has been sent enough for now. The station decides how long that lasts.</summary>
    public sealed record TooMany : ResetResult;

    /// <summary>The station read what was typed and it is not an email address.</summary>
    /// <remarks>
    /// A 400 is the only thing the route refuses that way, and "could not reach the station" about a
    /// typo sends somebody to check their network instead of their spelling.
    /// </remarks>
    public sealed record NotAnAddress : ResetResult;

    /// <summary>The station has no mail server to send through, so no link can reach anybody.</summary>
    public sealed record NoMail : ResetResult;

    /// <summary>Anything else: no network, a station that is down. The detail is for the log, not the page.</summary>
    public sealed record Failed(string? Detail) : ResetResult;
}
