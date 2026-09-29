using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Configuration;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One store on the station's disk, as figures somebody reads.</summary>
public sealed record StorageRowViewModel(
    string Label,
    string Path,
    string OnDisk,
    string Files,
    string? Missing,
    string Unclaimed,
    int? Share,
    string? ShareNote)
{
    public bool HasShare => Share is not null;

    public bool HasMissing => Missing is not null;

    /// <summary>A store at or past its limit, which the station is already trimming.</summary>
    public bool IsFull => Share >= 100;

    /// <summary>A store as a row. Public and static because every figure on it is worth a test.</summary>
    /// <remarks>
    /// On disk and what the database claims are separate figures that disagree in two directions, and
    /// each means something different: bytes no row claims are what a crash between writing a file and
    /// its row leaves, and a row whose file has gone is what emptying a directory leaves. Neither is
    /// repaired automatically, so neither is folded into the other here.
    /// </remarks>
    public static StorageRowViewModel From(StorageStore store)
    {
        ArgumentNullException.ThrowIfNull(store);

        var share = ByteSize.Share(store.Bytes, store.CapBytes);

        return new StorageRowViewModel(
            store.Label,
            store.Path,
            ByteSize.Format(store.Bytes),
            store.Files.ToString("N0", CultureInfo.CurrentCulture),
            store.RowsWithNoFile > 0 ? $"{store.RowsWithNoFile.ToString("N0", CultureInfo.CurrentCulture)} missing" : null,
            store.OrphanFiles > 0 ? ByteSize.Format(store.OrphanBytes) : "—",
            share,
            share is { } used && store.CapBytes is { } cap ? $"{used}% of {ByteSize.Format(cap)}" : null);
    }
}

/// <summary>
/// What the station is keeping on its disk, and where: the console's Storage card.
/// </summary>
/// <remarks>
/// A reading rather than a live figure, because walking the directories is real work for the station;
/// so it is read when the section is shown and never polled.
/// </remarks>
public sealed partial class StorageSectionViewModel(SettingsCalls calls) : ObservableObject, ISettingsSectionContent
{
    public ObservableCollection<StorageRowViewModel> Stores { get; } = [];

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private bool _loaded;

    [ObservableProperty]
    private string _total = string.Empty;

    [ObservableProperty]
    private string _totalFiles = string.Empty;

    [ObservableProperty]
    private string? _footnote;

    public bool IsDirty => false;

    public void Shown() => LoadCommand.Execute(null);

    public void Reset()
    {
        Stores.Clear();
        Loaded = false;
        Footnote = null;
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            var report = await calls.Actions.RunAsync(
                async token =>
                {
                    using var sdk = calls.Sdk();
                    return await sdk.Storage.ReadStorageAsync(token).ConfigureAwait(false);
                },
                cancellationToken: cancellationToken).ConfigureAwait(true);

            if (report is not null)
            {
                Present(report);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    public void Present(StorageReport report)
    {
        ArgumentNullException.ThrowIfNull(report);

        Stores.Clear();
        foreach (var store in report.Stores)
        {
            Stores.Add(StorageRowViewModel.From(store));
        }

        Total = ByteSize.Format(report.TotalBytes);
        TotalFiles = report.TotalFiles.ToString("N0", CultureInfo.CurrentCulture);
        Footnote = $"Read at {ClockFormat.WallClock(report.ReadAt.ToLocalTime())}. Walking the directories is real work, so this is a reading "
            + "rather than a live figure. Nothing here is deleted automatically: a file no row claims and a record whose file has gone are "
            + "both reported and left alone.";
        Loaded = true;
    }
}
