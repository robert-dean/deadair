using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>A plugin that could do a job and is not asked: switched off, or not answering.</summary>
public sealed record ProviderIdleViewModel(string Name, string Status, StatusTone Tone, string Why);

/// <summary>One place in an asking order.</summary>
public sealed record ProviderPlaceViewModel(string PluginId, string Name, string Place, bool CanRaise, bool CanLower);

/// <summary>
/// One job more than one plugin could do, and which of them does it.
/// </summary>
/// <remarks>
/// Two shapes, as the station says: a job one plugin does at a time is a PICK, saved the moment it is
/// chosen, and a job several are asked for in turn is an ORDER, moved with buttons and saved with its
/// own button, because a half-reordered list is not a thing to put on air one move at a time. Both
/// write to the setting the station names for the job.
/// </remarks>
public sealed partial class ProviderCapabilityViewModel : ObservableObject
{
    private readonly SettingsCalls _calls;
    private readonly Func<Task> _reread;
    private readonly IReadOnlyList<string> _saved;
    private readonly Dictionary<string, string> _names;
    private readonly bool _choosing;
    private List<string> _order;

    public ProviderCapabilityViewModel(ProviderCapabilityState state, SettingsCalls calls, Func<Task> reread)
    {
        ArgumentNullException.ThrowIfNull(state);

        State = state;
        _calls = calls;
        _reread = reread;

        var only = state.Candidates.Count == 1 ? state.Candidates[0] : null;
        (Title, Meaning, var onlyLine) = ProviderChoices.Words(state.Capability, only?.Name ?? string.Empty);
        OnlyLine = only is null ? null : onlyLine;

        var ordered = state.Mode == ProviderMode.Ordered;
        Idle = [.. ProviderChoices.Idle(state).Select(candidate => new ProviderIdleViewModel(
            candidate.Name,
            PluginStatusWords.Label(candidate.Status),
            PluginStatusWords.Tone(candidate.Status),
            (candidate.Enabled ? "switched on and not answering" : "not switched on") + (ordered ? ", so it is not asked" : string.Empty)))];

        // A pick.
        Options = ProviderChoices.PickOptions(state);
        var named = state.Configured.Trim();
        _chosen = Options.FirstOrDefault(option => option.Value == named) ?? Options[0];
        Unanswered = state.Unanswered
            ? $"{named} is named here and is not running, and naming a plugin means the station uses that one or none. Choose one that is running, or set this back to Automatic."
            : null;

        // An order. Only the plugins that can answer have a place; the rest are drawn below it.
        _names = state.Candidates.ToDictionary(candidate => candidate.PluginId, candidate => candidate.Name, StringComparer.Ordinal);
        _saved = [.. ProviderChoices.Asked(state).Select(candidate => candidate.PluginId)];
        _order = [.. _saved];
        IsTheirs = named.Length > 0;
        Stale = state.Stale.Count == 0 ? null
            : $"Your saved order also names {string.Join(", ", state.Stale)}, which nothing installed answers to. It is ignored. Saving this list again drops it.";
        StaleCount = state.Stale.Count switch
        {
            0 => null,
            1 => "1 listed plugin is not running",
            var count => $"{count} listed plugins are not running",
        };

        Draw();
        _choosing = true;
    }

    public ProviderCapabilityState State { get; }

    public string Title { get; }

    public string Meaning { get; }

    /// <summary>The line for a job only one plugin can do, when there is nothing to choose.</summary>
    public string? OnlyLine { get; }

    public bool IsOnly => OnlyLine is not null;

    public bool IsPick => !IsOnly && State.Mode == ProviderMode.One;

    public bool IsOrder => !IsOnly && State.Mode == ProviderMode.Ordered;

    public IReadOnlyList<ProviderIdleViewModel> Idle { get; }

    public bool HasIdle => !IsOnly && Idle.Count > 0;

    public IReadOnlyList<ProviderOption> Options { get; }

    [ObservableProperty]
    private ProviderOption _chosen;

    /// <summary>A named plugin that is not running, which means NOTHING is doing the job.</summary>
    public string? Unanswered { get; }

    public ObservableCollection<ProviderPlaceViewModel> Order { get; } = [];

    /// <summary>Whether the order is somebody's decision, as opposed to the station's own default.</summary>
    public bool IsTheirs { get; }

    public string Whose => IsTheirs ? "Your order" : "Default order";

    public string? Stale { get; }

    public string? StaleCount { get; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    private bool _isDirty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanSave))]
    private bool _busy;

    public bool CanSave => IsDirty && !Busy;

    partial void OnChosenChanged(ProviderOption value)
    {
        if (_choosing)
        {
            _ = SaveAsync(ProviderChoices.Pick(value.Value));
        }
    }

    [RelayCommand]
    private void Raise(ProviderPlaceViewModel place) => Move(place, -1);

    [RelayCommand]
    private void Lower(ProviderPlaceViewModel place) => Move(place, 1);

    private void Move(ProviderPlaceViewModel place, int by)
    {
        ArgumentNullException.ThrowIfNull(place);

        if (ProviderChoices.Move(_order, _order.IndexOf(place.PluginId), by) is { } moved)
        {
            _order = [.. moved];
            Draw();
        }
    }

    [RelayCommand]
    private Task SaveOrderAsync() => SaveAsync(ProviderChoices.Order(_order));

    /// <summary>Back to the station's own order, by clearing the row rather than storing an empty list.</summary>
    [RelayCommand]
    private Task ResetOrderAsync() => SaveAsync(FormValues.Clear);

    private void Draw()
    {
        Order.Clear();
        for (var index = 0; index < _order.Count; index++)
        {
            var id = _order[index];
            Order.Add(new ProviderPlaceViewModel(
                id,
                _names.TryGetValue(id, out var name) ? name : id,
                (index + 1).ToString(System.Globalization.CultureInfo.CurrentCulture),
                index > 0,
                index < _order.Count - 1));
        }

        IsDirty = !_order.SequenceEqual(_saved, StringComparer.Ordinal);
    }

    private async Task SaveAsync(JsonElement value)
    {
        Busy = true;
        try
        {
            var saved = await _calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = _calls.Sdk();
                    return await sdk.Settings.UpdateSettingsAsync(
                        new StationSettingsInput { Values = new Dictionary<string, JsonElement> { [State.SettingKey] = value } },
                        token).ConfigureAwait(false);
                }).ConfigureAwait(true);

            if (saved is not null)
            {
                await _reread().ConfigureAwait(true);
            }
        }
        finally
        {
            Busy = false;
        }
    }
}

/// <summary>
/// Which of the installed plugins does each job, and in what order they are asked: the console's
/// Providers section.
/// </summary>
/// <remarks>
/// Its settings ARE declared, in the <c>providers</c> group, and it still draws its own card: the
/// question is which plugin does a job, and a form of text fields holding plugin ids is the shape
/// that made that question hard to answer in the first place.
/// </remarks>
public sealed partial class ProvidersSectionViewModel(SettingsCalls calls) : ObservableObject, ISettingsSectionContent
{
    public ObservableCollection<ProviderCapabilityViewModel> Capabilities { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    private bool _loaded;

    public bool IsEmpty => Loaded && Capabilities.Count == 0;

    public bool IsDirty => Capabilities.Any(capability => capability.IsDirty);

    /// <summary>Read again each time it is shown, unless an order is half moved: re-reading would put it back.</summary>
    public void Shown()
    {
        if (!IsDirty)
        {
            LoadCommand.Execute(null);
        }
    }

    public void Reset()
    {
        Capabilities.Clear();
        Loaded = false;
        OnPropertyChanged(nameof(IsDirty));
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var catalogue = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Plugins.ListCapabilityProvidersAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (catalogue is not null)
            {
                Present(catalogue);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    public void Present(ProviderCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        Capabilities.Clear();
        foreach (var state in catalogue.Capabilities)
        {
            var capability = new ProviderCapabilityViewModel(state, calls, () => LoadCommand.ExecuteAsync(null));
            capability.PropertyChanged += (_, e) =>
            {
                if (e.PropertyName == nameof(ProviderCapabilityViewModel.IsDirty))
                {
                    OnPropertyChanged(nameof(IsDirty));
                }
            };
            Capabilities.Add(capability);
        }

        Loaded = true;
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(IsDirty));
    }
}
