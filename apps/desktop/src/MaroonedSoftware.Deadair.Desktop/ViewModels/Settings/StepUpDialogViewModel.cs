using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>An authenticator the step-up can ask for a code from.</summary>
public sealed record StepUpFactorViewModel(string MethodId, string Label);

/// <summary>
/// "Confirm it is you": a code from the operator's authenticator, for a change the station will not
/// make on an older proof. The console's step-up dialog.
/// </summary>
/// <remarks>
/// <para>
/// Asked for by <see cref="OperatorActions.StepUp"/>, which then tries the refused call again, so
/// every page gets it: issuing a key, registering an app, removing a factor, and anything the station
/// decides later needs one. It is installed once, by <see cref="Install"/>.
/// </para>
/// <para>
/// A challenge lists EVERY enrolled factor, and only an authenticator can be answered here, so the
/// list is filtered by method (the bug that taught this is in this app's CLAUDE.md, under the second
/// factor). An account with none is told so rather than shown a box no code can satisfy.
/// </para>
/// </remarks>
public sealed partial class StepUpDialogViewModel : DialogViewModel
{
    private readonly SessionManager _session;
    private readonly SettingsCalls _calls;
    private string? _challengeId;

    public StepUpDialogViewModel(SessionManager session, SettingsCalls calls)
    {
        _session = session;
        _calls = calls;
    }

    /// <summary>Makes every refused-for-a-second-factor call ask here and try again.</summary>
    /// <remarks>
    /// Posted to the UI thread, because the refusal arrives wherever the call's continuation ran
    /// (<see cref="OperatorActions"/> does not come back to the UI thread) and a dialog is UI state.
    /// </remarks>
    public static void Install(OperatorActions actions, SessionManager session, SettingsCalls calls, IUiDispatcher dispatcher)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(dispatcher);

        actions.StepUp ??= _ =>
        {
            var answered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            dispatcher.Post(async () =>
            {
                try
                {
                    answered.TrySetResult(await calls.Dialogs.ShowAsync(new StepUpDialogViewModel(session, calls).Start()).ConfigureAwait(true));
                }
                catch (Exception failure) when (failure is SdkException or HttpRequestException or InvalidOperationException)
                {
                    answered.TrySetResult(false);
                }
            });
            return answered.Task;
        };
    }

    public override string Title => "Confirm it is you";

    public override string AcceptLabel => "Verify";

    public override bool CanAccept => _challengeId is not null && Chosen is not null && AccountWords.IsCode(Code.Trim());

    public ObservableCollection<StepUpFactorViewModel> Factors { get; } = [];

    /// <summary>Whether there is more than one authenticator to choose between, which is the only time a choice is drawn.</summary>
    public bool HasChoice => Factors.Count > 1;

    [ObservableProperty]
    private StepUpFactorViewModel? _chosen;

    [ObservableProperty]
    private string _code = string.Empty;

    /// <summary>While the challenge is being asked for.</summary>
    [ObservableProperty]
    private bool _starting;

    partial void OnCodeChanged(string value) => Revalidate();

    partial void OnChosenChanged(StepUpFactorViewModel? value) => Revalidate();

    /// <summary>Asks the station for a challenge to answer. Returns this, so it can be shown as it starts.</summary>
    public StepUpDialogViewModel Start()
    {
        _ = StartAsync();
        return this;
    }

    private async Task StartAsync()
    {
        Starting = true;
        try
        {
            using var sdk = _calls.Sdk();
            var answer = await sdk.AuthenticationFactor.StartMfaChallengeAsync(
                new StepUpStartRequest { AcceptableMethods = [AuthenticationFactorMethod.Authenticator] }).ConfigureAwait(true);

            Present(answer);
        }
        catch (SdkException failure)
        {
            Problem = ApiError.Message(failure) ?? "The station could not issue a challenge.";
        }
        finally
        {
            Starting = false;
        }
    }

    /// <summary>Draws a challenge, or says there is nothing to answer it with.</summary>
    public void Present(StepUpStartResponse answer)
    {
        Factors.Clear();

        if (answer is MfaRequiredResponse challenge)
        {
            _challengeId = challenge.ChallengeId;
            foreach (var factor in challenge.Factors.Where(factor => factor.Method == AuthenticationFactorMethod.Authenticator))
            {
                Factors.Add(new StepUpFactorViewModel(factor.MethodId, factor.Label is { Length: > 0 } label ? label : "Authenticator"));
            }
        }

        Chosen = Factors.FirstOrDefault();
        OnPropertyChanged(nameof(HasChoice));

        if (Factors.Count == 0)
        {
            _challengeId = null;
            Problem = "This account has no authenticator this app can ask for. Enrol one under Sign-in and security first.";
        }

        Revalidate();
    }

    public override async Task<bool> AcceptAsync(CancellationToken cancellationToken)
    {
        if (_challengeId is not { } challenge || Chosen is not { } factor)
        {
            return false;
        }

        var result = await _session.StepUpAsync(challenge, factor.MethodId, Code.Trim(), cancellationToken).ConfigureAwait(true);
        Problem = Describe(result);
        if (result is not SignInResult.Ok)
        {
            Code = string.Empty;
        }

        return result is SignInResult.Ok;
    }

    /// <summary>What a refused code is told, the console's words for each of the station's three rejections.</summary>
    public static string? Describe(SignInResult result) => result switch
    {
        SignInResult.Ok => null,
        SignInResult.BadCredentials => "That code was not accepted. Wait for the next one and try again.",
        SignInResult.ChallengeExpired => "That took too long, and the station has let the question go. Cancel and try the change again.",
        SignInResult.FactorRefused => "The station would not take a code from that authenticator.",
        SignInResult.Unsupported unsupported => unsupported.Detail,
        SignInResult.Failed { Detail: { } detail } => detail,
        _ => "Could not check that code. Try again.",
    };
}
