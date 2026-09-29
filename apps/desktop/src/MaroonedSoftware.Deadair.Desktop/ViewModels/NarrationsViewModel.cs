using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One piece of a book or a column the station reads out.</summary>
public sealed class PieceRowViewModel
{
    public PieceRowViewModel(StationPiece piece, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(piece);

        Piece = piece;
        var state = NarrationRules.State(piece, now);
        (Tone, State) = NarrationRules.Describe(state);
        CanRender = NarrationRules.CanRender(state);

        Facts = string.Join(" · ", new[]
        {
            NarrationRules.Position(piece.Ordinal),
            piece.PublishedAt is { } published ? NewsViewModel.When(published) : null,
            NarrationRules.Words(piece.WordCount),
        }.OfType<string>());

        // Why it will not be read, and why it could not be: the station's own answers to "why did it
        // skip chapter seven", which this is the only place to learn.
        When = piece.AiredAt is { } aired
            ? $"Read {NewsViewModel.When(aired)}."
            : piece.WithdrawnAt is { } withdrawn
                ? $"Withdrawn {NewsViewModel.When(withdrawn)}: its source no longer lists it, so the station will not read it."
                : null;
        Failure = piece.AiredAt is null ? piece.RenderError : null;
    }

    public StationPiece Piece { get; }

    public string Id => Piece.Id;

    public string Series => Piece.SeriesTitle;

    public string Title => Piece.Title;

    public string? Summary => string.IsNullOrWhiteSpace(Piece.Summary) ? null : Piece.Summary;

    public bool HasSummary => Summary is not null;

    public StatusTone Tone { get; }

    public string State { get; }

    /// <summary>Where it comes in its book, when it was published, and how long it is.</summary>
    public string Facts { get; }

    public string? When { get; }

    public bool HasWhen => When is not null;

    public string? Failure { get; }

    public bool HasFailure => Failure is not null;

    public bool CanRender { get; }
}

/// <summary>
/// The books and columns the station reads out in its presenter's voice, and what it has done with
/// each piece.
/// </summary>
/// <remarks>
/// A <c>narration</c> band on the format clock reads the next piece at its time (the next chapter of a
/// book, or the newest issue of a column) and the station speaks it a few hours beforehand. Read it now
/// is for wanting it sooner, or again after a failure; Look for new pieces asks the series to be read
/// at once rather than at the next half hour.
/// </remarks>
public sealed partial class NarrationsViewModel(OperatorActions actions, HttpClient http, TimeProvider? time = null)
    : LibraryTabViewModel(actions, http)
{
    private readonly TimeProvider _time = time ?? TimeProvider.System;

    /// <summary>The series, with every series first. Choosing reuses the podcasts' choice, whose shape is the same.</summary>
    public ObservableCollection<ShowChoiceViewModel> Series { get; } = [];

    public ObservableCollection<PieceRowViewModel> Pieces { get; } = [];

    [ObservableProperty]
    private ShowChoiceViewModel? _chosen;

    [ObservableProperty]
    private string? _empty;

    public bool HasSeries => Series.Count > 1;

    partial void OnChosenChanged(ShowChoiceViewModel? value)
    {
        if (value is not null && Series.Count > 0)
        {
            _ = ReadPiecesAsync(CancellationToken.None);
        }
    }

    protected override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        var series = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Narrations.ListSeriesAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (series is null)
        {
            return false;
        }

        PresentSeries(series);
        return await ReadPiecesAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>Draws the series the station reads. Public so a frame can be posed from them.</summary>
    public void PresentSeries(StationSeriesList series)
    {
        ArgumentNullException.ThrowIfNull(series);

        Series.Clear();
        Series.Add(new ShowChoiceViewModel(null, "Every series"));
        foreach (var one in series.Series)
        {
            Series.Add(new ShowChoiceViewModel(one.Id, one.Title));
        }

        OnPropertyChanged(nameof(HasSeries));

#pragma warning disable MVVMTK0034
        // Straight to the field: choosing through the property would read the pieces twice.
        _chosen = Series[0];
#pragma warning restore MVVMTK0034
        OnPropertyChanged(nameof(Chosen));
    }

    private async Task<bool> ReadPiecesAsync(CancellationToken cancellationToken)
    {
        var id = Chosen?.Id;
        var page = await Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Narrations.ListPiecesAsync(new StationPieceQuery { SeriesId = id }, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return false;
        }

        PresentPieces(page);
        return true;
    }

    /// <summary>Draws the pieces the station answered with. Public so a frame can be posed from them.</summary>
    public void PresentPieces(StationPiecePage page)
    {
        ArgumentNullException.ThrowIfNull(page);

        var now = _time.GetUtcNow();
        Pieces.Clear();
        foreach (var piece in page.Pieces)
        {
            Pieces.Add(new PieceRowViewModel(piece, now));
        }

        Empty = Series.Count <= 1
            ? "The station has nothing to read yet. Install a narration plugin and point it at a book or a feed on its own settings; what it offers arrives here once the station has looked."
            : Pieces.Count == 0
                ? "The station has found no pieces yet. It looks twice an hour; look now to see what there is."
                : null;
    }

    [RelayCommand]
    private async Task LookAsync()
    {
        if (await Actions.DoAsync(async token =>
            {
                using var sdk = Sdk();
                await sdk.Narrations.RefreshNarrationsAsync(token).ConfigureAwait(false);
            }).ConfigureAwait(true))
        {
            Notice = "The station is reading every series again. New pieces appear here in a minute or two.";
        }
    }

    /// <summary>Asks the station to speak a piece now rather than a few hours before its band.</summary>
    [RelayCommand]
    private async Task RenderAsync(PieceRowViewModel row)
    {
        ArgumentNullException.ThrowIfNull(row);

        var piece = await Actions.RunAsync(async token =>
        {
            using var sdk = Sdk();
            return await sdk.Narrations.RenderPieceAsync(row.Id, token).ConfigureAwait(false);
        }).ConfigureAwait(true);

        if (piece is null)
        {
            return;
        }

        var index = Pieces.IndexOf(row);
        if (index >= 0)
        {
            Pieces[index] = new PieceRowViewModel(piece, _time.GetUtcNow());
        }

        Notice = $"Reading {row.Title}. It is ready to air once the station has spoken it.";
    }

    public override void Reset()
    {
        base.Reset();
        Series.Clear();
        Pieces.Clear();
        Empty = null;
        OnPropertyChanged(nameof(HasSeries));
    }
}
