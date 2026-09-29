using System.Collections.ObjectModel;
using Avalonia.Media.Imaging;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// A card on the Sign-in and security section: read when the section is shown, and absent for an
/// account the station will not show it to.
/// </summary>
public abstract partial class SecurityCardViewModel(SettingsCalls calls) : ObservableObject
{
    protected SettingsCalls Calls { get; } = calls;

    /// <summary>The station refused this account the read, so the card is not drawn at all, as the console's are not.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsShown))]
    private bool _hidden;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsShown))]
    private bool _loaded;

    public bool IsShown => Loaded && !Hidden;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    public abstract Task LoadAsync(CancellationToken cancellationToken);

    public virtual void Reset()
    {
        Loaded = false;
        Hidden = false;
        Notice = null;
    }

    /// <summary>Reads for the card, hiding it on a refusal of this account, and answers what came back.</summary>
    protected async Task<T?> ReadAsync<T>(Func<Sdk.DeadairSdk, CancellationToken, Task<T>> read, CancellationToken cancellationToken)
        where T : class
    {
        var (value, forbidden) = await Calls.ReadAsync(read, cancellationToken).ConfigureAwait(true);
        Hidden = forbidden;
        Loaded = value is not null || forbidden || Loaded;
        return value;
    }

    protected async Task CopyAsync(string text, string said)
    {
        if (Calls.Shell is { } shell)
        {
            await shell.CopyAsync(text).ConfigureAwait(true);
            Notice = said;
        }
    }
}

/// <summary>One factor this account signs in with.</summary>
public sealed record FactorRowViewModel(string Name, AuthenticationFactorMethod Method, string MethodId, bool IsAuthenticator);

/// <summary>
/// How you sign in: the factors on this account, and an authenticator added or taken away. The
/// console's "How you sign in" card, the authenticator half.
/// </summary>
/// <remarks>
/// <para>
/// Enrolling is the console's three steps: ask for a registration (with the hash of a secret only this
/// app holds, so it cannot be finished anywhere else), scan the QR code the STATION drew, and prove the
/// scan with the first code. The QR code arrives as a PNG in a <c>data:</c> URI, so this app draws a
/// picture it was handed and needs no QR library of its own; the key is shown beside it as text, with
/// Copy, for an authenticator on the same Mac.
/// </para>
/// <para>
/// Finishing hands back a token for this session that now carries the new factor as verified, and it
/// is adopted (<see cref="SessionManager.AdoptAsync"/>), which is what lets the next change here pass
/// the station's recent-factor gate without a separate step-up.
/// </para>
/// </remarks>
public sealed partial class FactorsCardViewModel(SettingsCalls calls, SessionManager session) : SecurityCardViewModel(calls)
{
    private string? _verifier;
    private string? _registrationId;

    public ObservableCollection<FactorRowViewModel> Factors { get; } = [];

    [ObservableProperty]
    private bool _hasAuthenticator;

    /// <summary>What to call a new authenticator, so two can be told apart later.</summary>
    [ObservableProperty]
    private string _newLabel = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsIdle))]
    private bool _enrolling;

    public bool IsIdle => !Enrolling;

    [ObservableProperty]
    private Bitmap? _qrCode;

    [ObservableProperty]
    private string? _secret;

    [ObservableProperty]
    private string _firstCode = string.Empty;

    public override async Task LoadAsync(CancellationToken cancellationToken)
    {
        var factors = await ReadAsync((sdk, token) => sdk.AuthenticationFactor.ListFactorsAsync(token), cancellationToken).ConfigureAwait(true);
        if (factors is not null)
        {
            Present(factors);
        }
    }

    public void Present(IReadOnlyList<AuthenticationFactor> factors)
    {
        ArgumentNullException.ThrowIfNull(factors);

        Factors.Clear();
        foreach (var factor in factors)
        {
            Factors.Add(new FactorRowViewModel(
                AccountWords.Factor(factor.Method, factor.Label),
                factor.Method,
                factor.MethodId,
                factor.Method == AuthenticationFactorMethod.Authenticator));
        }

        HasAuthenticator = Factors.Any(factor => factor.IsAuthenticator);
        Loaded = true;
    }

    [RelayCommand]
    private async Task StartEnrolAsync(CancellationToken cancellationToken)
    {
        Notice = null;
        _verifier = Pkce.Verifier();
        var label = NewLabel.Trim();
        var started = await Calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = Calls.Sdk();
                return await sdk.AuthenticationFactor.RegisterFactorAsync(
                    new AuthenticatorFactorRegistration { CodeChallenge = Pkce.Challenge(_verifier), Label = label.Length > 0 ? label : null },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (started is AuthenticatorFactorRegistrationResponse registration)
        {
            ShowRegistration(registration);
        }
    }

    /// <summary>Draws a registration to scan: the station's picture of it, and its key as text.</summary>
    public void ShowRegistration(AuthenticatorFactorRegistrationResponse registration)
    {
        ArgumentNullException.ThrowIfNull(registration);

        _registrationId = registration.RegistrationId;
        Secret = registration.Secret;
        FirstCode = string.Empty;

        QrCode?.Dispose();
        QrCode = AccountWords.DataUri(registration.QrCode) is { } png ? Decode(png) : null;
        Enrolling = true;
    }

    private static Bitmap? Decode(byte[] png)
    {
        try
        {
            using var stream = new MemoryStream(png);
            return new Bitmap(stream);
        }
        catch (Exception failure) when (failure is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            // The key is beside it as text, which is enough to enrol with.
            return null;
        }
    }

    [RelayCommand]
    private async Task VerifyEnrolAsync(CancellationToken cancellationToken)
    {
        if (_registrationId is not { } registration || _verifier is not { } verifier)
        {
            return;
        }

        if (!AccountWords.IsCode(FirstCode.Trim()))
        {
            Notice = "Enter the six digits the app shows.";
            return;
        }

        var token = await Calls.Actions.RunAsync(
            async call =>
            {
                using var sdk = Calls.Sdk();
                return await sdk.AuthenticationFactor.VerifyFactorRegistrationAsync(
                    new AuthenticatorFactorRegistrationVerification { RegistrationId = registration, Code = FirstCode.Trim(), CodeVerifier = verifier },
                    call).ConfigureAwait(false);
            },
            new Dictionary<int, string>
            {
                [400] = "That code was not accepted. Wait for the next one and try again.",
                [401] = "That code was not accepted. Wait for the next one and try again.",
            },
            cancellationToken).ConfigureAwait(true);

        if (token is null)
        {
            FirstCode = string.Empty;
            return;
        }

        await session.AdoptAsync(token.AccessToken, token.RefreshToken, cancellationToken).ConfigureAwait(true);
        CancelEnrol();
        NewLabel = string.Empty;
        Notice = "Authenticator enrolled. Every sign-in to this account now asks for its code after the password.";
        await LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    [RelayCommand]
    private void CancelEnrol()
    {
        Enrolling = false;
        _registrationId = null;
        _verifier = null;
        Secret = null;
        QrCode?.Dispose();
        QrCode = null;
    }

    [RelayCommand]
    private Task CopySecretAsync() => Secret is { } secret ? CopyAsync(secret, "The key is on the clipboard.") : Task.CompletedTask;

    [RelayCommand]
    private async Task RemoveAsync(FactorRowViewModel factor, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(factor);

        var last = Factors.Count(row => row.IsAuthenticator) == 1;
        if (!factor.IsAuthenticator
            || !await Calls.Dialogs.ConfirmAsync(
                $"Remove {factor.Name}?",
                "Codes from this app will stop being accepted." + (last ? " It is the last authenticator on the account, so sign-in goes back to the password alone." : string.Empty),
                "Remove").ConfigureAwait(true))
        {
            return;
        }

        if (await Calls.Actions.DoAsync(
                async token =>
                {
                    using var sdk = Calls.Sdk();
                    await sdk.AuthenticationFactor.RemoveFactorAsync(factor.Method, factor.MethodId, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true))
        {
            Notice = $"{factor.Name} removed.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    public override void Reset()
    {
        base.Reset();
        Factors.Clear();
        CancelEnrol();
    }
}

/// <summary>One API key.</summary>
public sealed record ApiKeyRowViewModel(Guid Id, string Name, string Line, string State, bool IsActive);

/// <summary>A choice of how long a new key lasts.</summary>
public sealed record ExpiryChoice(string Label, int Days);

/// <summary>
/// API keys: for a script that should reach the station as this account without its password. The
/// console's API keys card.
/// </summary>
/// <remarks>
/// A key's secret is shown ONCE, when it is made or rotated, because the station keeps only a
/// fingerprint of it; the panel that shows it stays until Done so it is not lost to a stray click.
/// Issuing and rotating sit behind the station's step-up, which <see cref="OperatorActions"/> asks for.
/// </remarks>
public sealed partial class ApiKeysCardViewModel(SettingsCalls calls, TimeProvider? time = null) : SecurityCardViewModel(calls)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    public ObservableCollection<ApiKeyRowViewModel> Keys { get; } = [];

    [ObservableProperty]
    private bool _isEmpty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanCreate))]
    private string _newName = string.Empty;

    /// <summary>Whether the new key may change things, rather than only read them.</summary>
    [ObservableProperty]
    private bool _newManages;

    private static readonly ExpiryChoice[] Choices = [new("Never", 0), new("30 days", 30), new("90 days", 90), new("1 year", 365)];

    public static IReadOnlyList<ExpiryChoice> Expiries => Choices;

    /// <remarks>The list's own instance rather than an equal one, so the box selects exactly what it is handed.</remarks>
    [ObservableProperty]
    private ExpiryChoice _newExpiry = Choices[0];

    public bool CanCreate => NewName.Trim().Length > 0;

    /// <summary>The secret just issued, shown once.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasIssued))]
    private string? _issuedToken;

    [ObservableProperty]
    private string? _issuedTitle;

    [ObservableProperty]
    private string? _issuedBody;

    public bool HasIssued => IssuedToken is not null;

    public override async Task LoadAsync(CancellationToken cancellationToken)
    {
        var list = await ReadAsync((sdk, token) => sdk.AuthenticationApikeys.ListApiKeysAsync(token), cancellationToken).ConfigureAwait(true);
        if (list is not null)
        {
            Present(list);
        }
    }

    public void Present(ApiKeyList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        var now = _time.GetUtcNow();
        Keys.Clear();
        foreach (var key in list.Keys)
        {
            var state = AccountWords.KeyState(key, now);
            var line = string.Join(
                " · ",
                AccountWords.Access(key.Scopes),
                key.LastUsedAt is { } used ? $"used {AccountWords.Date(used)}" : "never used",
                key.ExpiresAt is { } expires ? $"expires {AccountWords.Date(expires)}" : "never expires");
            Keys.Add(new ApiKeyRowViewModel(key.Id, key.Name, line, state, state == "active"));
        }

        IsEmpty = Keys.Count == 0;
        Loaded = true;
    }

    [RelayCommand]
    private async Task CreateAsync(CancellationToken cancellationToken)
    {
        var name = NewName.Trim();
        if (name.Length == 0)
        {
            return;
        }

        var issued = await Calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = Calls.Sdk();
                return await sdk.AuthenticationApikeys.CreateApiKeyAsync(
                    new ApiKeyCreate
                    {
                        Name = name,
                        Scopes = [NewManages ? ApiKeyScope.Manage : ApiKeyScope.View],
                        ExpiresAt = AccountWords.Expiry(NewExpiry.Days, _time.GetUtcNow()),
                    },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (issued is not null)
        {
            NewName = string.Empty;
            ShowIssued(issued, rotated: false);
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    public void ShowIssued(ApiKeyIssued issued, bool rotated)
    {
        ArgumentNullException.ThrowIfNull(issued);

        IssuedToken = issued.Token;
        IssuedTitle = rotated ? $"{issued.Key.Name}: new token" : $"{issued.Key.Name}: key created";
        IssuedBody = (rotated
            ? "The old token has stopped working. Copy this one now; it will not be shown again."
            : "Copy it now. The station keeps only a fingerprint of it and can never show it again.")
            + " Send it as Authorization: Bearer <key>.";
    }

    [RelayCommand]
    private Task CopyTokenAsync() => IssuedToken is { } token ? CopyAsync(token, "The key is on the clipboard.") : Task.CompletedTask;

    [RelayCommand]
    private void DoneWithIssued()
    {
        IssuedToken = null;
        IssuedTitle = null;
        IssuedBody = null;
        Notice = null;
    }

    [RelayCommand]
    private async Task RotateAsync(ApiKeyRowViewModel key, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(key);

        if (!await Calls.Dialogs.ConfirmAsync(
                $"Rotate {key.Name}?",
                "The current token stops working at once, and the new one is shown here once. Whatever uses this key needs the new token before its next request.",
                "Rotate").ConfigureAwait(true))
        {
            return;
        }

        var issued = await Calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = Calls.Sdk();
                return await sdk.AuthenticationApikeys.RotateApiKeyAsync(key.Id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (issued is not null)
        {
            ShowIssued(issued, rotated: true);
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task RevokeAsync(ApiKeyRowViewModel key, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(key);

        if (!await Calls.Dialogs.ConfirmAsync(
                $"Revoke {key.Name}?",
                "Every request made with this key is refused from the next one on. It stays in this list, marked revoked.",
                "Revoke").ConfigureAwait(true))
        {
            return;
        }

        if (await Calls.Actions.DoAsync(
                async token =>
                {
                    using var sdk = Calls.Sdk();
                    await sdk.AuthenticationApikeys.RevokeApiKeyAsync(key.Id, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true))
        {
            Notice = $"{key.Name} revoked.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    public override void Reset()
    {
        base.Reset();
        Keys.Clear();
        DoneWithIssued();
    }
}

/// <summary>One chat account linked to this one.</summary>
public sealed record ChatLinkRowViewModel(string PluginId, string PlatformUserId, string Name, string Linked);

/// <summary>
/// Chat accounts: a Telegram, Discord or Slack account linked to this one, so a chat command can do
/// what this account can. The console's Chat accounts card.
/// </summary>
public sealed partial class ChatAccountsCardViewModel(SettingsCalls calls) : SecurityCardViewModel(calls)
{
    public ObservableCollection<ChatLinkRowViewModel> Links { get; } = [];

    [ObservableProperty]
    private bool _isEmpty;

    /// <summary>The code to send the station's bot, once made.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasCode), nameof(CodeAction))]
    private string? _code;

    [ObservableProperty]
    private string? _codeHint;

    public bool HasCode => Code is not null;

    public string CodeAction => HasCode ? "New code" : "Link a chat account";

    public override async Task LoadAsync(CancellationToken cancellationToken)
    {
        var list = await ReadAsync((sdk, token) => sdk.Messaging.ListMessagingLinksAsync(token), cancellationToken).ConfigureAwait(true);
        if (list is not null)
        {
            Present(list);
        }
    }

    public void Present(MessagingLinkList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Links.Clear();
        foreach (var link in list.Links)
        {
            Links.Add(new ChatLinkRowViewModel(
                link.PluginId,
                link.PlatformUserId,
                $"{link.DisplayName} on {AccountWords.Platform(link.PluginId)}",
                $"Linked {AccountWords.Date(link.CreatedAt)}"));
        }

        IsEmpty = Links.Count == 0;
        Loaded = true;
    }

    [RelayCommand]
    private async Task NewCodeAsync(CancellationToken cancellationToken)
    {
        var code = await Calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = Calls.Sdk();
                return await sdk.Messaging.CreateMessagingLinkCodeAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (code is not null)
        {
            ShowCode(code);
        }
    }

    public void ShowCode(MessagingLinkCode code)
    {
        ArgumentNullException.ThrowIfNull(code);

        Code = code.Code;
        CodeHint = "Send this to the station's bot in a direct message, not a group. It works once, until "
            + $"{Core.NowPlaying.ClockFormat.WallClock(code.ExpiresAt.ToLocalTime())}.";
    }

    [RelayCommand]
    private Task CopyCodeAsync() => Code is { } code ? CopyAsync(code, "The code is on the clipboard.") : Task.CompletedTask;

    [RelayCommand]
    private async Task UnlinkAsync(ChatLinkRowViewModel link, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(link);

        if (!await Calls.Dialogs.ConfirmAsync(
                $"Unlink {link.Name}?",
                "Its operator commands are refused from the next one on. You can link it again with a new code.",
                "Unlink").ConfigureAwait(true))
        {
            return;
        }

        if (await Calls.Actions.DoAsync(
                async token =>
                {
                    using var sdk = Calls.Sdk();
                    await sdk.Messaging.RemoveMessagingLinkAsync(link.PluginId, link.PlatformUserId, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true))
        {
            Notice = $"{link.Name} unlinked.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    public override void Reset()
    {
        base.Reset();
        Links.Clear();
        Code = null;
        CodeHint = null;
    }
}

/// <summary>One app this account has let act as it.</summary>
public sealed record ConnectedAppRowViewModel(Guid Id, string Name, string Line);

/// <summary>
/// Connected apps: the apps this account approved to act as it, such as a Claude connector. The
/// console's Connected apps card. Disconnecting needs no second factor, since taking access away is
/// never the change a stolen session wants.
/// </summary>
public sealed partial class ConnectedAppsCardViewModel(SettingsCalls calls) : SecurityCardViewModel(calls)
{
    public ObservableCollection<ConnectedAppRowViewModel> Apps { get; } = [];

    [ObservableProperty]
    private bool _isEmpty;

    public override async Task LoadAsync(CancellationToken cancellationToken)
    {
        var list = await ReadAsync((sdk, token) => sdk.Oauth.ListOAuthGrantsAsync(token), cancellationToken).ConfigureAwait(true);
        if (list is not null)
        {
            Present(list);
        }
    }

    public void Present(OAuthGrantList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Apps.Clear();
        foreach (var grant in list.Grants)
        {
            var line = $"{AccountWords.Access(grant.Scope)} · connected {AccountWords.Date(grant.CreatedAt)}"
                + (grant.LastUsedAt is { } used ? $" · last used {AccountWords.Date(used)}" : string.Empty);
            Apps.Add(new ConnectedAppRowViewModel(grant.Id, grant.ClientName ?? grant.ClientId, line));
        }

        IsEmpty = Apps.Count == 0;
        Loaded = true;
    }

    [RelayCommand]
    private async Task DisconnectAsync(ConnectedAppRowViewModel app, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(app);

        if (!await Calls.Dialogs.ConfirmAsync(
                $"Disconnect {app.Name}?",
                $"{app.Name} stops working as you straight away. You can connect it again later, and you will be asked to approve it again.",
                "Disconnect").ConfigureAwait(true))
        {
            return;
        }

        if (await Calls.Actions.DoAsync(
                async token =>
                {
                    using var sdk = Calls.Sdk();
                    await sdk.Oauth.RevokeOAuthGrantAsync(app.Id, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true))
        {
            Notice = $"{app.Name} disconnected.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    public override void Reset()
    {
        base.Reset();
        Apps.Clear();
    }
}
