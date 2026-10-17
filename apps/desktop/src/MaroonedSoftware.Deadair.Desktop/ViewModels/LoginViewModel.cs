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
    [NotifyPropertyChangedFor(nameof(ShowsPasswordStep))]
    private bool _needsCode;

    /// <summary>
    /// The address a password-reset link was asked for, once the station has answered. Set, the panel
    /// says to check that inbox instead of drawing the form.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ResetSent))]
    [NotifyPropertyChangedFor(nameof(ShowsPasswordStep))]
    [NotifyPropertyChangedFor(nameof(ResetSentWords))]
    private string? _resetSentTo;

    /// <summary>True once a reset link has been asked for and the station has taken the request.</summary>
    public bool ResetSent => ResetSentTo is not null;

    /// <summary>The email and password fields: neither on the code step nor after a reset was asked for.</summary>
    public bool ShowsPasswordStep => !NeedsCode && !ResetSent;

    /// <summary>
    /// Where the link went and what happens next. It opens the station's web console rather than this
    /// app, so the words say to choose the password there and come back.
    /// </summary>
    public string ResetSentWords => ResetSentTo is null
        ? string.Empty
        : $"If {ResetSentTo} has an account on this station, a link to choose a new password is on its way. "
            + "It opens the station in your browser. Then come back and sign in here with the new password.";

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

    /// <summary>
    /// "Forgot your password?": asks the station to email a reset link to the address typed.
    /// </summary>
    /// <remarks>
    /// Only the address is needed, the password being what this is instead of, so with none typed the
    /// answer is to type one rather than to send a blank address to the station to be told so.
    /// </remarks>
    [RelayCommand]
    private async Task ForgotPasswordAsync(CancellationToken cancellationToken)
    {
        var email = Email.Trim();
        if (email.Length == 0)
        {
            Problem = "Enter your email address first.";
            return;
        }

        Problem = null;
        Busy = true;

        try
        {
            switch (await session.AskForResetAsync(email, cancellationToken).ConfigureAwait(true))
            {
                case ResetResult.Sent:
                    Password = string.Empty;
                    ResetSentTo = email;
                    break;
                case ResetResult.TooMany:
                    Problem = "That address has been sent enough links for now. Try again in a few minutes.";
                    break;
                case ResetResult.NoMail:
                    Problem = "The station cannot send email, so it cannot send a link. Ask whoever runs it.";
                    break;
                case ResetResult.Failed:
                    Problem = "Could not reach the station to send a link.";
                    break;
            }
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>
    /// Goes back to the password step, for somebody who cannot reach their authenticator, or who has
    /// read the check-your-inbox panel.
    /// </summary>
    [RelayCommand]
    private void Cancel()
    {
        ResetSentTo = null;
        NeedsCode = false;
        Code = string.Empty;
        Problem = null;
        _challengeId = null;
        _factor = null;
    }
}
