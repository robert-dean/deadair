using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One thing a plugin asked for beyond its manifest, and the operator's answer to it.
/// </summary>
/// <remarks>
/// The answer is two buttons rather than a switch, as the console's is a segmented control: allowing
/// and denying are both deliberate, and a switch reads as "on or not yet" rather than as a decision.
/// A decision takes effect on the plugin's next request, and the station answers with the whole list,
/// which is handed to whoever drew this row.
/// </remarks>
public sealed partial class PluginGrantRowViewModel(PluginGrant grant, SettingsCalls calls, Action<PluginGrantList> decided) : ObservableObject
{
    public PluginGrant Grant { get; } = grant;

    public string PluginName => Grant.PluginName;

    public string Label => Grant.Label;

    /// <summary>The plugin's own words for why, quoted, because they are its words and not the station's.</summary>
    public string Reason => $"“{Grant.Reason}”";

    public string Describes => Grant.Describes;

    public bool IsAllowed => Grant.Decision == GrantDecision.Allowed;

    public bool IsDenied => Grant.Decision == GrantDecision.Denied;

    public string State => IsAllowed ? "Allowed" : "Denied";

    public StatusTone Tone => IsAllowed ? StatusTone.Ok : StatusTone.Off;

    [ObservableProperty]
    private bool _busy;

    [RelayCommand]
    private Task AllowAsync(CancellationToken cancellationToken) => DecideAsync(GrantDecision.Allowed, cancellationToken);

    [RelayCommand]
    private Task DenyAsync(CancellationToken cancellationToken) => DecideAsync(GrantDecision.Denied, cancellationToken);

    private async Task DecideAsync(GrantDecision decision, CancellationToken cancellationToken)
    {
        if (decision == Grant.Decision)
        {
            return;
        }

        Busy = true;
        try
        {
            var list = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Plugins.DecidePluginGrantAsync(
                        Grant.PluginId,
                        new PluginGrantInput { Capability = Grant.Capability, Decision = decision },
                        token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (list is not null)
            {
                decided(list);
            }
        }
        finally
        {
            Busy = false;
        }
    }
}

/// <summary>
/// What plugins have asked for on top of their manifests: the console's "Waiting on you".
/// </summary>
/// <remarks>
/// Nothing having asked for anything is the ordinary state of a station, since almost every plugin
/// does its whole job inside what it declares. The console hides its card then; a section here cannot
/// hide from its own list, so it says that in a sentence instead of drawing a heading over an empty
/// table.
/// </remarks>
public sealed partial class GrantsSectionViewModel(SettingsCalls calls) : ObservableObject, ISettingsSectionContent
{
    public ObservableCollection<PluginGrantRowViewModel> Grants { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    private bool _loaded;

    public bool IsEmpty => Loaded && Grants.Count == 0;

    public bool IsDirty => false;

    public void Shown() => LoadCommand.Execute(null);

    public void Reset()
    {
        Grants.Clear();
        Loaded = false;
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var list = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Plugins.ListPluginGrantsAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (list is not null)
            {
                Present(list);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    public void Present(PluginGrantList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Grants.Clear();
        foreach (var grant in list.Grants)
        {
            Grants.Add(new PluginGrantRowViewModel(grant, calls, Present));
        }

        Loaded = true;
        OnPropertyChanged(nameof(IsEmpty));
    }
}
