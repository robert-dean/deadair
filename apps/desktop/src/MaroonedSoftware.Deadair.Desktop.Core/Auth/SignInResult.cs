using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Auth;

/// <summary>What happened when somebody tried to sign in.</summary>
public abstract record SignInResult
{
    private SignInResult()
    {
    }

    /// <summary>Signed in.</summary>
    public sealed record Ok : SignInResult;

    /// <summary>The station did not accept that email and password.</summary>
    public sealed record BadCredentials : SignInResult;

    /// <summary>
    /// The station wants a second factor, which arrives as a 200 rather than an error.
    /// </summary>
    /// <remarks>
    /// A client that reads the status code alone sees a successful sign-in with no token in it. The
    /// challenge is satisfied by posting a proof grant carrying <paramref name="ChallengeId"/>.
    /// </remarks>
    public sealed record SecondFactorNeeded(string ChallengeId, IReadOnlyList<MfaChallengeFactor> Factors) : SignInResult;

    /// <summary>The station answered something this build cannot complete.</summary>
    public sealed record Unsupported(string Detail) : SignInResult;

    /// <summary>Something else went wrong, with the station's own words where it gave any.</summary>
    public sealed record Failed(string? Detail) : SignInResult;
}
