using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One language the console can be shown in.</summary>
public sealed record ConsoleLanguageRowViewModel(string Locale, string Name, string Detail);

/// <summary>
/// The station's console language packs: listed, installed from a file, and removed. The console's
/// Languages card, without the half about the console itself.
/// </summary>
/// <remarks>
/// These are the WEB CONSOLE's languages, which the station keeps for every operator who opens it.
/// This app has no localization of its own (its words are English, in its view models, as the
/// Conventions section says), so installing a pack here changes nothing on this screen, and the
/// section says so rather than letting somebody wonder why the app did not change. Nor is it the
/// language the station BROADCASTS in, which is a Stream setting.
/// </remarks>
public sealed partial class LanguagesSectionViewModel(SettingsCalls calls) : ObservableObject, ISettingsSectionContent
{
    public ObservableCollection<ConsoleLanguageRowViewModel> Languages { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsEmpty))]
    private bool _loaded;

    [ObservableProperty]
    private string? _notice;

    public bool IsEmpty => Loaded && Languages.Count == 0;

    public bool IsDirty => false;

    public void Shown() => LoadCommand.Execute(null);

    public void Reset()
    {
        Languages.Clear();
        Loaded = false;
        Notice = null;
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
                    return await sdk.Languages.ListConsoleLanguagesAsync(token).ConfigureAwait(false);
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

    public void Present(ConsoleLanguageList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Languages.Clear();
        foreach (var language in list.Languages.OrderBy(language => language.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            Languages.Add(Row(language));
        }

        Loaded = true;
        OnPropertyChanged(nameof(IsEmpty));
    }

    /// <summary>A language as a row: its name, its tag, and when it came and what for.</summary>
    public static ConsoleLanguageRowViewModel Row(ConsoleLanguage language)
    {
        ArgumentNullException.ThrowIfNull(language);

        var detail = language.MadeFor.Length > 0
            ? $"Imported {AccountWords.Date(language.ImportedAt)}, made for console {language.MadeFor}"
            : $"Imported {AccountWords.Date(language.ImportedAt)}";

        if (language.Direction == ConsoleLanguageDirection.Rtl)
        {
            detail += " · right to left";
        }

        return new ConsoleLanguageRowViewModel(language.Locale, language.Name, detail);
    }

    /// <summary>
    /// Installs a pack somebody chose, after the console's own checks on what it says it is and a
    /// question naming it, and what it replaces.
    /// </summary>
    [RelayCommand]
    private async Task ImportAsync(CancellationToken cancellationToken)
    {
        if (calls.Files is not { } files
            || await files.OpenAsync("A console language pack", ["*.json"]).ConfigureAwait(true) is not { } picked)
        {
            return;
        }

        var (pack, problem) = LanguagePacks.Read(picked.Data, picked.Name);
        if (pack is null)
        {
            Notice = problem;
            return;
        }

        var replaces = Languages.FirstOrDefault(language => language.Locale == pack.Locale);
        if (!await calls.Dialogs.ConfirmAsync(
                $"Install {pack.Name}?",
                (replaces is null ? string.Empty : $"It replaces the {replaces.Name} pack already installed. ")
                + $"Every operator can then show the web console in {pack.Name}; this app stays in English."
                + (pack.Direction == ConsoleLanguagePackDirection.Rtl ? " Its text runs right to left, and the console turns its layout round for it." : string.Empty),
                "Install",
                destructive: false).ConfigureAwait(true))
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
                    return await sdk.Languages.ImportConsoleLanguageAsync(pack.Locale, pack, token).ConfigureAwait(false);
                },
                new Dictionary<int, string> { [403] = "Only an admin can install a language. Nothing was changed." },
                cancellationToken).ConfigureAwait(true);

            if (list is not null)
            {
                Present(list);
                Notice = $"{pack.Name} installed.";
            }
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task RemoveAsync(ConsoleLanguageRowViewModel language, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(language);

        if (!await calls.Dialogs.ConfirmAsync(
                $"Remove {language.Name}?",
                $"Anybody who has the console in {language.Name} goes back to English. The pack is gone from the station, so keep a copy if its translator still needs it.",
                "Remove").ConfigureAwait(true))
        {
            return;
        }

        var list = await calls.Actions.RunAsync(
            async token =>
            {
                using var sdk = calls.Sdk();
                return await sdk.Languages.RemoveConsoleLanguageAsync(language.Locale, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [403] = "Only an admin can remove a language. Nothing was changed." },
            cancellationToken).ConfigureAwait(true);

        if (list is not null)
        {
            Present(list);
            Notice = $"{language.Name} removed.";
        }
    }
}
