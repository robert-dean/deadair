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
    /// The authenticator the code will be sent against, when the account has one.
    /// </summary>
    /// <remarks>
    /// The AUTHENTICATOR, chosen out of the challenge rather than taken as its first entry. A
    /// challenge lists every enrolled factor in enrolment order, and sending a code with another
    /// one's method id is refused as `invalid_factor` — which at the keyboard is indistinguishable
    /// from a mistyped code, and was.
    /// </remarks>
    private MfaChallengeFactor? _factor;

    /// <summary>The challenge's email factor, when the account can also be sent a code.</summary>
    private MfaChallengeFactor? _emailFactor;

    /// <summary>
    /// The message an emailed code came in, which the <c>code</c> grant echoes back. Absent until the
    /// station has said it sent one: there is nothing to type before that.
    /// </summary>
    private string? _emailChallengeId;

    [ObservableProperty]
    private string _email = string.Empty;

    [ObservableProperty]
    private string _password = string.Empty;

    [ObservableProperty]
    private string _code = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSubmit))]
    private bool _busy;

    [ObservableProperty]
    private string? _problem;

    /// <summary>True once the station has asked for a second factor.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowsPasswordStep))]
    [NotifyPropertyChangedFor(nameof(CanUseEmail))]
    [NotifyPropertyChangedFor(nameof(CanSendAgain))]
    private bool _needsCode;

    /// <summary>
    /// True when the code being typed is one the station emails rather than one from an authenticator.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CodeWords))]
    [NotifyPropertyChangedFor(nameof(CanUseEmail))]
    [NotifyPropertyChangedFor(nameof(CanSendAgain))]
    private bool _usingEmail;

    /// <summary>While the station is being asked to email a code. Nothing can be submitted until it answers.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CodeWords))]
    [NotifyPropertyChangedFor(nameof(CanSubmit))]
    private bool _sendingCode;

    /// <summary>The station's label for the address a code went to, usually masked, when it gave one.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CodeWords))]
    private string? _sentTo;

    /// <summary>The sentence above the code box: where the code comes from.</summary>
    public string CodeWords => !UsingEmail
        ? "Enter the code from your authenticator."
        : SendingCode
            ? "Sending a code to your email."
            : SentTo is { Length: > 0 } to
                ? $"We sent a code to {to}."
                : "We sent a code to your email.";

    /// <summary>
    /// "Email me a code instead": on the authenticator step of an account that also has email, for
    /// somebody whose authenticator is on a phone they do not have with them.
    /// </summary>
    public bool CanUseEmail => NeedsCode && !UsingEmail && _emailFactor is not null;

    /// <summary>"Send it again": on an emailed code's step.</summary>
    public bool CanSendAgain => NeedsCode && UsingEmail;

    /// <summary>Sign in is pressable: not while anything is in flight, a send included.</summary>
    public bool CanSubmit => !Busy && !SendingCode;

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
        if (!CanSubmit || (UsingEmail && _emailChallengeId is null))
        {
            // Return in a box that is waiting on a send would have nothing to answer.
            return;
        }

        Problem = null;
        Busy = true;

        try
        {
            var result = !NeedsCode
                ? await session.SignInAsync(Email, Password, cancellationToken).ConfigureAwait(true)
                : UsingEmail
                    ? await session.CompleteEmailCodeAsync(
                        Email, _challengeId!, _emailChallengeId!, Code.Trim(), cancellationToken).ConfigureAwait(true)
                    : await session.CompleteSecondFactorAsync(
                        Email, _challengeId!, _factor!.MethodId, Code.Trim(), cancellationToken).ConfigureAwait(true);

            switch (result)
            {
                case SignInResult.Ok:
                    Password = string.Empty;
                    ForgetChallenge();
                    SignedIn?.Invoke();
                    break;

                case SignInResult.SecondFactorNeeded challenge:
                    // A 200 rather than an error. The password step is done and the panel becomes a
                    // code box, keeping the email so nobody retypes it. The AUTHENTICATOR leads when
                    // there is one, because it costs nothing to offer where choosing email sends a
                    // message; email leads only when there is no authenticator.
                    var authenticators = ChallengeFactors.Authenticators(challenge.Factors);
                    var authenticator = authenticators.Count > 0 ? authenticators[0] : null;
                    var emailed = ChallengeFactors.Email(challenge.Factors);
                    if (authenticator is null && emailed is null)
                    {
                        // A passkey or a phone, which this app cannot answer. Saying so beats a code
                        // box that would refuse every code.
                        Problem = "This account's second factor is one this app cannot use, such as a passkey. "
                            + "Sign in on the web console instead.";
                        break;
                    }

                    _challengeId = challenge.ChallengeId;
                    _factor = authenticator;
                    _emailFactor = emailed;
                    _emailChallengeId = null;
                    SentTo = emailed?.Label;
                    Password = string.Empty;
                    Code = string.Empty;
                    UsingEmail = authenticator is null;
                    NeedsCode = true;

                    if (UsingEmail)
                    {
                        await SendCodeAsync(cancellationToken).ConfigureAwait(true);
                    }

                    break;

                case SignInResult.BadCredentials:
                    // An authenticator's next code is half a minute away; an emailed one is the same
                    // code until it is sent again, so the advice differs.
                    Problem = !NeedsCode
                        ? "That email and password were not accepted."
                        : UsingEmail
                            ? "That code was not accepted. Check the latest email, or send it again."
                            : "That code was not accepted. Check your authenticator and try the next one.";
                    if (NeedsCode)
                    {
                        Code = string.Empty;
                    }

                    break;

                case SignInResult.ChallengeExpired:
                    // Not a wrong code: there is nothing left to answer, so the code box goes away
                    // rather than inviting another attempt that cannot work.
                    Problem = "That sign-in took too long and has expired. Start again.";
                    ForgetChallenge();
                    break;

                case SignInResult.FactorRefused:
                    Problem = "The station would not accept that factor for this sign-in. "
                        + "Start again, and tell Robert if it keeps happening.";
                    ForgetChallenge();
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
                case ResetResult.NotAnAddress:
                    Problem = "That is not an email address. Check what you typed.";
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
        Problem = null;
        ForgetChallenge();
    }

    /// <summary>
    /// "Email me a code instead", from the authenticator step. The challenge stays the same one, so
    /// nothing about the password step is repeated.
    /// </summary>
    [RelayCommand]
    private async Task UseEmailAsync(CancellationToken cancellationToken)
    {
        if (!CanUseEmail || Busy)
        {
            return;
        }

        UsingEmail = true;
        Code = string.Empty;
        await SendCodeAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>"Send it again", for an emailed code that has not arrived.</summary>
    [RelayCommand]
    private async Task SendAgainAsync(CancellationToken cancellationToken)
    {
        if (!CanSendAgain || Busy || SendingCode)
        {
            return;
        }

        await SendCodeAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>
    /// Poses the code step of an account with an email factor, for the shot tool: the authenticator
    /// step offering email instead, or (<paramref name="emailed"/>) an emailed code already sent with
    /// no authenticator beside it.
    /// </summary>
    /// <remarks>
    /// Public because the shot tool is a separate assembly, as <c>LoginView.Reveal</c> is. Nothing in
    /// the app calls it: the step is reached by signing in.
    /// </remarks>
    public void PoseCodeStep(string? sentTo, bool emailed)
    {
        _challengeId = "c_posed";
        _emailChallengeId = emailed ? "e_posed" : null;
        _factor = emailed
            ? null
            : new MfaChallengeFactor { Method = AuthenticationFactorMethod.Authenticator, MethodId = "totp", Kind = AuthenticationFactorKind.Possession };
        _emailFactor = new MfaChallengeFactor { Method = AuthenticationFactorMethod.Email, MethodId = "email", Kind = AuthenticationFactorKind.Possession, Label = sentTo };
        SentTo = sentTo;
        UsingEmail = emailed;
        NeedsCode = true;
    }

    /// <summary>
    /// Asks the station to email the code this step is waiting on: the challenge led with email,
    /// email was chosen, or it is being sent again.
    /// </summary>
    /// <remarks>
    /// The message id is dropped until the station answers, so nothing is submitted against a send
    /// still in flight. An answer for a challenge that was abandoned meanwhile (Back) is ignored.
    /// </remarks>
    private async Task SendCodeAsync(CancellationToken cancellationToken)
    {
        if (_challengeId is not { } challenge)
        {
            return;
        }

        Problem = null;
        _emailChallengeId = null;
        SendingCode = true;
        CodeSendResult result;
        try
        {
            result = await session.SendEmailCodeAsync(challenge, cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            SendingCode = false;
        }

        if (!string.Equals(_challengeId, challenge, StringComparison.Ordinal))
        {
            return;
        }

        switch (result)
        {
            case CodeSendResult.Sent sent:
                _emailChallengeId = sent.EmailChallengeId;
                break;

            case CodeSendResult.ChallengeExpired:
                // As on the code itself: the pending sign-in is gone, and only the password step
                // again can start another.
                Problem = "That sign-in took too long and has expired. Start again.";
                ForgetChallenge();
                break;

            case CodeSendResult.NoMail:
                Problem = "The station cannot send email, so it cannot send a code. Ask whoever runs it.";
                break;

            case CodeSendResult.Failed:
                Problem = "Could not send a code to your email. Try again.";
                break;
        }
    }

    /// <summary>Back to the password step, with nothing of the challenge left to answer.</summary>
    private void ForgetChallenge()
    {
        NeedsCode = false;
        UsingEmail = false;
        SentTo = null;
        Code = string.Empty;
        _challengeId = null;
        _factor = null;
        _emailFactor = null;
        _emailChallengeId = null;
        OnPropertyChanged(nameof(CanUseEmail));
    }
}
