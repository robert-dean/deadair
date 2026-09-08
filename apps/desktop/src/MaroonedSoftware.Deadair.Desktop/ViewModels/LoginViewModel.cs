using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// Signing in as the operator, including the second factor.
/// </summary>
/// <remarks>
/// Optional throughout. Listening needs no account at all, so this is reached from a panel rather
/// than gating the app, and signing out leaves somebody listening.
/// </remarks>
public sealed partial class LoginViewModel(SessionManager session) : ObservableObject
{
    private string? _challengeId;

    /// <summary>
    /// The factor the code will be sent against.
    /// </summary>
    /// <remarks>
    /// The AUTHENTICATOR, chosen out of the challenge rather than taken as its first entry. A
    /// challenge lists every enrolled factor in enrolment order, and sending a code with another
    /// one's method id is refused as `invalid_factor` — which at the keyboard is indistinguishable
    /// from a mistyped code, and was.
    /// </remarks>
    private MfaChallengeFactor? _factor;

    [ObservableProperty]
    private string _email = string.Empty;

    [ObservableProperty]
    private string _password = string.Empty;

    [ObservableProperty]
    private string _code = string.Empty;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _problem;

    /// <summary>True once the station has asked for a second factor.</summary>
    [ObservableProperty]
    private bool _needsCode;

    public event Action? SignedIn;

    [RelayCommand]
    private async Task SubmitAsync(CancellationToken cancellationToken)
    {
        Problem = null;
        Busy = true;

        try
        {
            var result = NeedsCode
                ? await session.CompleteSecondFactorAsync(
                    Email, _challengeId!, _factor!.MethodId, Code, cancellationToken).ConfigureAwait(true)
                : await session.SignInAsync(Email, Password, cancellationToken).ConfigureAwait(true);

            switch (result)
            {
                case SignInResult.Ok:
                    Password = string.Empty;
                    Code = string.Empty;
                    NeedsCode = false;
                    SignedIn?.Invoke();
                    break;

                case SignInResult.SecondFactorNeeded challenge:
                    // A 200 rather than an error. The password step is done and the panel becomes a
                    // code box, keeping the email so nobody retypes it.
                    var usable = ChallengeFactors.Authenticators(challenge.Factors);
                    if (usable.Count == 0)
                    {
                        // The account's second factor is something this app cannot answer. Saying so
                        // beats a code box that would refuse every code.
                        Problem = "This account's second factor is not one this app can complete yet. "
                            + "Sign in on the web console.";
                        break;
                    }

                    _challengeId = challenge.ChallengeId;
                    _factor = usable[0];
                    Password = string.Empty;
                    NeedsCode = true;
                    break;

                case SignInResult.BadCredentials:
                    Problem = NeedsCode
                        ? "That code was not accepted. Check your authenticator and try the next one."
                        : "That email and password were not accepted.";
                    break;

                case SignInResult.ChallengeExpired:
                    // Not a wrong code: there is nothing left to answer, so the code box goes away
                    // rather than inviting another attempt that cannot work.
                    Problem = "That sign-in took too long and has expired. Start again.";
                    NeedsCode = false;
                    Code = string.Empty;
                    _challengeId = null;
                    _factor = null;
                    break;

                case SignInResult.FactorRefused:
                    Problem = "The station would not accept that authenticator for this sign-in. "
                        + "Start again, and tell Robert if it keeps happening.";
                    NeedsCode = false;
                    Code = string.Empty;
                    _challengeId = null;
                    _factor = null;
                    break;

                case SignInResult.Unsupported unsupported:
                    Problem = unsupported.Detail;
                    break;

                case SignInResult.Failed failed:
                    Problem = failed.Detail ?? "The station refused the sign-in, and did not say why.";
                    break;
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>Goes back to the password step, for somebody who cannot reach their authenticator.</summary>
    [RelayCommand]
    private void Cancel()
    {
        NeedsCode = false;
        Code = string.Empty;
        Problem = null;
        _challengeId = null;
        _factor = null;
    }
}
