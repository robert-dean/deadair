using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One kind of break, and the picture a listener's player shows while it airs.</summary>
public sealed record BreakArtRowViewModel(string Kind, Uri? Picture, bool IsShipped, bool CanRevert)
{
    public string Initial => Kind.Length > 0 ? char.ToUpperInvariant(Kind[0]).ToString() : "?";

    public string Source => IsShipped ? "The one this station ships" : "Yours";

    /// <summary>Why Put the original back is greyed out, where it is.</summary>
    /// <remarks>
    /// Drawn for every kind and disabled where there is nothing to go back to, rather than hidden: a
    /// kind whose only picture is an upload is exactly where somebody looks for that button, and a
    /// control that is absent reads as a feature that is missing.
    /// </remarks>
    public string? RevertNote => CanRevert || IsShipped ? null : "This station ships no picture for that kind, so there is nothing to go back to.";
}

/// <summary>
/// The pictures a listener's player shows while the station talks: the console's Break artwork card.
/// </summary>
/// <remarks>
/// In Settings rather than on Voice because it is about what a listener SEES rather than what the
/// station says. The listing holds only kinds the station has bytes for; a kind with none wears the
/// station's logo, which is not a row worth drawing.
/// </remarks>
public sealed partial class ArtworkSectionViewModel(SettingsCalls calls) : ObservableObject, ISettingsSectionContent
{
    public ObservableCollection<BreakArtRowViewModel> Breaks { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private bool _loaded;

    [ObservableProperty]
    private string? _notice;

    public bool IsEmpty => Loaded && Breaks.Count == 0;

    public bool IsDirty => false;

    public void Shown() => LoadCommand.Execute(null);

    public void Reset()
    {
        Breaks.Clear();
        Loaded = false;
        Notice = null;
        OnPropertyChanged(nameof(IsEmpty));
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
                    return await sdk.ArtBreaks.ListBreakArtworkAsync(token).ConfigureAwait(false);
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

    /// <summary>Draws a listing, whether read or handed back by a change.</summary>
    public void Present(BreakArtworkList list)
    {
        ArgumentNullException.ThrowIfNull(list);

        Breaks.Clear();
        foreach (var one in list.Breaks)
        {
            Breaks.Add(new BreakArtRowViewModel(
                one.Kind,
                calls.Station.ArtUrl(one.Url),
                one.Source == BreakArtworkSource.Shipped,
                one.HasShipped && one.Source != BreakArtworkSource.Shipped));
        }

        Loaded = true;
        OnPropertyChanged(nameof(IsEmpty));
    }

    [RelayCommand]
    private async Task ReplaceAsync(BreakArtRowViewModel row, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (calls.Files is not { } files
            || await files.OpenAsync($"A picture for a {row.Kind} break", ImageUpload.Patterns).ConfigureAwait(true) is not { } picked)
        {
            return;
        }

        if (ImageUpload.Problem(picked.Name, picked.Data.LongLength) is { } problem)
        {
            Notice = problem;
            return;
        }

        Notice = null;
        Busy = true;
        try
        {
            var list = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.ArtBreaks.ReplaceBreakArtworkAsync(
                        row.Kind,
                        [SdkPart.File("file", picked.Data, picked.Name, ImageUpload.ContentType(picked.Name)!)],
                        token).ConfigureAwait(false);
                },
                new Dictionary<int, string> { [422] = "The station would not take that picture." },
                cancellationToken).ConfigureAwait(true);

            if (list is not null)
            {
                Present(list);
                Notice = $"A {row.Kind} break now shows your picture.";
            }
        }
        finally
        {
            Busy = false;
        }
    }

    [RelayCommand]
    private async Task RevertAsync(BreakArtRowViewModel row, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (!row.CanRevert
            || !await calls.Dialogs.ConfirmAsync(
                $"Put the original {row.Kind} picture back?",
                "Your picture is let go, and every listener's player shows the one this station ships from the next break of that kind.",
                "Put it back").ConfigureAwait(true))
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
                    return await sdk.ArtBreaks.RevertBreakArtworkAsync(row.Kind, token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (list is not null)
            {
                Present(list);
                Notice = null;
            }
        }
        finally
        {
            Busy = false;
        }
    }
}
