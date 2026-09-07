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
    private IReadOnlyList<MfaChallengeFactor> _factors = [];

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
                    Email, _challengeId!, _factors[0].MethodId, Code, cancellationToken).ConfigureAwait(true)
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
                    _challengeId = challenge.ChallengeId;
                    _factors = challenge.Factors;
                    Password = string.Empty;
                    NeedsCode = true;
                    break;

                case SignInResult.BadCredentials:
                    Problem = NeedsCode
                        ? "That code was not accepted."
                        : "That email and password were not accepted.";
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
    }
}
