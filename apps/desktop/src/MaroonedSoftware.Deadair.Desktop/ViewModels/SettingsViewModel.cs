using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Settings;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Themes;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One group of the station's settings, as the station groups them.</summary>
public sealed record SettingGroupViewModel(string Name, IReadOnlyList<SettingFieldViewModel> Fields);

/// <summary>
/// The station's settings, and this app's own.
/// </summary>
/// <remarks>
/// <para>
/// The station's half is drawn entirely from what it declares, so a setting added there appears here
/// with no code. The app's half is Appearance, which is local to this install and never leaves it.
/// </para>
/// <para>
/// Only what CHANGED is sent. A partial write is what the endpoint takes, and sending everything back
/// would overwrite a value somebody else edited while this page was open.
/// </para>
/// </remarks>
public sealed partial class SettingsViewModel(
    OperatorActions actions,
    HttpClient http,
    ISettingsStore settings,
    ThemeManager themes) : ObservableObject
{
    private StationUrl _station;

    public ObservableCollection<SettingGroupViewModel> Groups { get; } = [];

    /// <remarks>
    /// An instance property because XAML binds to one, and it reads the static list rather than
    /// copying it: the three themes are the same three for every window.
    /// </remarks>
#pragma warning disable CA1822 // Instance so that a view can bind to it.
    public IReadOnlyList<ThemeChoice> Themes => ConsoleThemes.All;
#pragma warning restore CA1822

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    public void Attach(StationUrl station)
    {
        _station = station;
        MarkChosen(settings.Current.Theme);
    }

    /// <remarks>
    /// Applied at once and remembered, because a theme somebody has to press Save to see is a theme
    /// they cannot judge.
    /// </remarks>
    [RelayCommand]
    private async Task ChooseThemeAsync(ThemeChoice choice)
    {
        ArgumentNullException.ThrowIfNull(choice);

        themes.Apply(choice.Id);
        MarkChosen(choice.Id);

        await settings.SaveAsync(settings.Current with { Theme = choice.Id }).ConfigureAwait(true);
    }

    private static void MarkChosen(ThemeId chosen)
    {
        foreach (var choice in ConsoleThemes.All)
        {
            choice.IsChosen = choice.Id == chosen;
        }
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        Notice = null;

        try
        {
            var station = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();
                    return await sdk.Settings.GetSettingsAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (station is null)
            {
                return;
            }

            Groups.Clear();
            foreach (var group in station.Descriptors.GroupBy(descriptor => descriptor.Group))
            {
                var fields = group
                    .Select(descriptor => new SettingFieldViewModel(
                        descriptor,
                        station.Values.TryGetValue(descriptor.Key, out var value) ? value : null,
                        station.Configured.TryGetValue(descriptor.Key, out var configured) && configured))
                    .ToList();

                Groups.Add(new SettingGroupViewModel(Title(group.Key.ToString()), fields));
            }
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        var changed = Groups
            .SelectMany(group => group.Fields)
            .Where(field => field.IsDirty)
            .ToDictionary(
                field => field.Key,

                // Every value travels as a string: every layer of the station's configuration holds
                // text, so a JSON boolean would be a shape it does not store.
                field => JsonSerializer.SerializeToElement(field.Current));

        if (changed.Count == 0)
        {
            Notice = "Nothing has changed.";
            return;
        }

        Busy = true;
        try
        {
            var saved = await actions.RunAsync(
                async token =>
                {
                    using var sdk = Sdk();

                    // Partial: sending everything back would overwrite a value somebody else changed
                    // while this page was open.
                    return await sdk.Settings.UpdateSettingsAsync(
                        new StationSettingsInput { Values = changed },
                        token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (saved is null)
            {
                return;
            }

            Notice = changed.Count == 1 ? "Saved one setting." : $"Saved {changed.Count} settings.";
            await LoadAsync(cancellationToken).ConfigureAwait(true);
        }
        finally
        {
            Busy = false;
        }
    }

    /// <summary>A group's key as a heading: `llm` and `housekeeping` are not titles.</summary>
    private static string Title(string key) => key.Length switch
    {
        0 => key,
        _ => char.ToUpperInvariant(key[0]) + key[1..],
    };

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
