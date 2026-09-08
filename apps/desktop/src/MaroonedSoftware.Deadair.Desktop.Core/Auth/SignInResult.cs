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

    /// <summary>The station did not accept that email and password, or that code.</summary>
    public sealed record BadCredentials : SignInResult;

    /// <summary>
    /// The challenge is gone: it expired, or it was already spent.
    /// </summary>
    /// <remarks>
    /// Told apart from a wrong code because the remedy is different. A code can be retyped; an
    /// expired challenge cannot be answered at all and the password step has to be done again.
    /// </remarks>
    public sealed record ChallengeExpired : SignInResult;

    /// <summary>
    /// The station will not accept that factor for this challenge.
    /// </summary>
    /// <remarks>
    /// Almost always a client bug rather than anything the operator did: it means the method id sent
    /// with the code was not one of the challenge's eligible authenticators.
    /// </remarks>
    public sealed record FactorRefused : SignInResult;

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

/// <summary>
/// Which of a challenge's factors this app can actually answer.
/// </summary>
/// <remarks>
/// <b>Only the authenticator.</b> A challenge lists every factor the account has enrolled, in
/// enrolment order, so the first one is not reliably the one a code box can satisfy — and the station
/// refuses a code sent with another factor's method id, as `invalid_factor`, which reads at the
/// keyboard exactly like a mistyped code. The web console filters the same way.
/// </remarks>
public static class ChallengeFactors
{
    public static IReadOnlyList<MfaChallengeFactor> Authenticators(IReadOnlyList<MfaChallengeFactor> factors)
    {
        ArgumentNullException.ThrowIfNull(factors);

        return factors.Where(factor => factor.Method == AuthenticationFactorMethod.Authenticator).ToList();
    }
}
