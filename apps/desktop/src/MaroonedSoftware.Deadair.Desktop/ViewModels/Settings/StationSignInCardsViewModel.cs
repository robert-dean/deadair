using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One identity provider the sign-in page offers, and whether it answered.</summary>
public sealed record SigninProviderRowViewModel(string Label, string Issuer, string Verdict, StatusTone Tone, string? Problem);

/// <summary>
/// "Do they answer?": the station asks each provider for its sign-in details, the way the sign-in
/// page will. The console's sign-in check card.
/// </summary>
public sealed partial class SigninCheckCardViewModel(SettingsCalls calls) : SecurityCardViewModel(calls)
{
    public ObservableCollection<SigninProviderRowViewModel> Providers { get; } = [];

    [ObservableProperty]
    private bool _isEmpty;

    public override async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var check = await ReadAsync((sdk, token) => sdk.Settings.CheckSignInProvidersAsync(token), cancellationToken).ConfigureAwait(true);
            if (check is not null)
            {
                Present(check);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    public void Present(SigninProvidersCheck check)
    {
        ArgumentNullException.ThrowIfNull(check);

        Providers.Clear();
        foreach (var provider in check.Providers)
        {
            var offered = !check.Unusable.Contains(provider.Name);
            var (verdict, tone) = (offered, provider.Ok) switch
            {
                (false, _) => ("Not offered", StatusTone.Off),
                (true, true) => ("Answers", StatusTone.Ok),
                _ => ("No answer", StatusTone.Fault),
            };

            Providers.Add(new SigninProviderRowViewModel(provider.Label, provider.Issuer, verdict, tone, provider.Problem));
        }

        IsEmpty = Providers.Count == 0;
        Loaded = true;
    }

    [RelayCommand]
    private Task CheckAgainAsync(CancellationToken cancellationToken) => LoadAsync(cancellationToken);

    public override void Reset()
    {
        base.Reset();
        Providers.Clear();
    }
}

/// <summary>One app registered with the station.</summary>
public sealed record OAuthClientRowViewModel(string ClientId, string Name, string Kind, string Method, string Redirects, string Used);

/// <summary>How a new app proves who it is.</summary>
public sealed record ClientMethodChoice(string Label, OAuthClientAuthMethod Method);

/// <summary>
/// Registered apps: the apps allowed to ask somebody here for access. The console's OAuth clients card.
/// </summary>
/// <remarks>
/// Registering one gives it nothing until a person approves it. An app registered by hand that keeps a
/// secret is handed it ONCE, here, as a key is. Registering sits behind the station's step-up.
/// </remarks>
public sealed partial class OAuthClientsCardViewModel(SettingsCalls calls) : SecurityCardViewModel(calls)
{
    public ObservableCollection<OAuthClientRowViewModel> Clients { get; } = [];

    [ObservableProperty]
    private bool _isEmpty;

    [ObservableProperty]
    private string _newName = string.Empty;

    /// <summary>Where it may be sent back to, one address per line.</summary>
    [ObservableProperty]
    private string _newRedirects = string.Empty;

    public IReadOnlyList<ClientMethodChoice> Methods { get; } =
    [
        new(AccountWords.ClientMethod(OAuthClientAuthMethod.None), OAuthClientAuthMethod.None),
        new(AccountWords.ClientMethod(OAuthClientAuthMethod.ClientSecretPost), OAuthClientAuthMethod.ClientSecretPost),
        new(AccountWords.ClientMethod(OAuthClientAuthMethod.ClientSecretBasic), OAuthClientAuthMethod.ClientSecretBasic),
    ];

    [ObservableProperty]
    private ClientMethodChoice? _newMethod;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasIssued), nameof(HasIssuedSecret))]
    private string? _issuedClientId;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasIssuedSecret))]
    private string? _issuedSecret;

    [ObservableProperty]
    private string? _issuedTitle;

    public bool HasIssued => IssuedClientId is not null;

    public bool HasIssuedSecret => IssuedSecret is not null;

    public override async Task LoadAsync(CancellationToken cancellationToken)
    {
        var list = await ReadAsync((sdk, token) => sdk.Oauth.ListOAuthClientsAsync(token), cancellationToken).ConfigureAwait(true);
        if (list is not null)
        {
            Present(list);
        }
    }

    public void Present(OAuthClientList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        NewMethod ??= Methods[0];
        Clients.Clear();
        foreach (var client in list.Clients)
        {
            var used = client.LastUsedAt is { } last ? $"Last used {AccountWords.Date(last)}" : "Never used";
            if (client.ExpiresAt is { } lapses)
            {
                used += $" · lapses {AccountWords.Date(lapses)} unless used again";
            }

            Clients.Add(new OAuthClientRowViewModel(
                client.ClientId,
                client.Name ?? client.ClientId,
                client.Kind == OAuthClientSummaryKind.Preregistered ? "registered here" : "registered itself",
                AccountWords.ClientMethod(client.TokenEndpointAuthMethod),
                string.Join(", ", client.RedirectUris),
                used));
        }

        IsEmpty = Clients.Count == 0;
        Loaded = true;
    }

    [RelayCommand]
    private async Task RegisterAsync(CancellationToken cancellationToken)
    {
        var name = NewName.Trim();
        var (redirects, problem) = AccountWords.Redirects(NewRedirects);
        if (name.Length == 0)
        {
            Notice = "Give it a name, so its approval screen says what is asking.";
            return;
        }

        if (problem is not null)
        {
            Notice = problem;
            return;
        }

        var method = (NewMethod ?? Methods[0]).Method;
        var issued = await Calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = Calls.Sdk();
                return await sdk.Oauth.CreateOAuthClientAsync(
                    new OAuthClientCreate { Name = name, RedirectUris = [.. redirects], TokenEndpointAuthMethod = method },
                    token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (issued is null)
        {
            return;
        }

        Notice = null;
        NewName = string.Empty;
        NewRedirects = string.Empty;
        IssuedTitle = $"{issued.Client.Name ?? name}: registered";
        IssuedClientId = issued.Client.ClientId;
        IssuedSecret = issued.ClientSecret;
        await LoadAsync(cancellationToken).ConfigureAwait(true);
    }

    [RelayCommand]
    private Task CopyClientIdAsync() => IssuedClientId is { } id ? CopyAsync(id, "The client id is on the clipboard.") : Task.CompletedTask;

    [RelayCommand]
    private Task CopySecretAsync() => IssuedSecret is { } secret ? CopyAsync(secret, "The client secret is on the clipboard.") : Task.CompletedTask;

    [RelayCommand]
    private void DoneWithIssued()
    {
        IssuedClientId = null;
        IssuedSecret = null;
        IssuedTitle = null;
        Notice = null;
    }

    [RelayCommand]
    private async Task WithdrawAsync(OAuthClientRowViewModel client, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(client);

        if (!await Calls.Dialogs.ConfirmAsync(
                $"Withdraw {client.Name}?",
                $"Everybody who approved {client.Name} is disconnected from it, and every token it holds stops working. An app that registers itself can register again, and somebody will have to approve it again.",
                "Withdraw").ConfigureAwait(true))
        {
            return;
        }

        if (await Calls.Actions.DoAsync(
                async token =>
                {
                    using var sdk = Calls.Sdk();
                    await sdk.Oauth.RevokeOAuthClientAsync(client.ClientId, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true))
        {
            Notice = $"{client.Name} withdrawn.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
    }

    public override void Reset()
    {
        base.Reset();
        Clients.Clear();
        DoneWithIssued();
    }
}

/// <summary>
/// Sign-in and security, the console's two halves on one section: how YOU sign in (your factors, your
/// keys, your chat accounts, the apps you approved), then how everybody else may (the <c>signin</c>
/// group through the shared form, whether its providers answer, and the apps registered here).
/// </summary>
/// <remarks>
/// The halves differ in who may change them, which is said with a heading rather than a second
/// section. The form saves the station half only, so its button says so rather than promising the
/// whole section.
/// </remarks>
public sealed partial class SecuritySectionViewModel : ObservableObject, ISettingsSectionContent
{
    public SecuritySectionViewModel(SettingsGroupViewModel group, SettingsCalls calls, Core.Auth.SessionManager session)
    {
        ArgumentNullException.ThrowIfNull(group);

        Group = group;
        Factors = new FactorsCardViewModel(calls, session);
        ApiKeys = new ApiKeysCardViewModel(calls);
        ChatAccounts = new ChatAccountsCardViewModel(calls);
        ConnectedApps = new ConnectedAppsCardViewModel(calls);
        SigninCheck = new SigninCheckCardViewModel(calls);
        OAuthClients = new OAuthClientsCardViewModel(calls);

        group.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(SettingsGroupViewModel.IsDirty))
            {
                OnPropertyChanged(nameof(IsDirty));
            }
        };
    }

    /// <summary>The station half's declared settings, saved like any other group's.</summary>
    public SettingsGroupViewModel Group { get; }

    public FactorsCardViewModel Factors { get; }

    public ApiKeysCardViewModel ApiKeys { get; }

    public ChatAccountsCardViewModel ChatAccounts { get; }

    public ConnectedAppsCardViewModel ConnectedApps { get; }

    public SigninCheckCardViewModel SigninCheck { get; }

    public OAuthClientsCardViewModel OAuthClients { get; }

    private IEnumerable<SecurityCardViewModel> Cards => [Factors, ApiKeys, ChatAccounts, ConnectedApps, SigninCheck, OAuthClients];

    public bool IsDirty => Group.IsDirty;

    /// <summary>Every card read again, together: they are six small reads, and each answers a different question.</summary>
    public void Shown()
    {
        foreach (var card in Cards)
        {
            _ = card.LoadAsync(CancellationToken.None);
        }
    }

    public void Reset()
    {
        foreach (var card in Cards)
        {
            card.Reset();
        }
    }
}
