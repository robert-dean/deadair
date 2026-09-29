using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One copy of a record, as a row.</summary>
public sealed record CopyRowViewModel(
    string Provider,
    string ExternalId,
    bool Found,
    StatusTone Tone,
    string State,
    string Detail,
    string Format,
    string Held,
    string LastPlayed);

/// <summary>One figure of a measurement.</summary>
public sealed record FigureViewModel(string Label, string Value);

/// <summary>One time the record went out.</summary>
public sealed record AiringRowViewModel(string When, string Source);

/// <summary>
/// One record: where it comes from, whether it has been measured, when it aired, what the providers
/// say, and what can be done about it when it will not play.
/// </summary>
/// <remarks>
/// This is the page somebody opens to find out why a record behaves as it does, so it leads with the
/// copies (a record with none can never play) and carries the repairs the records list does, asking
/// the same way.
/// </remarks>
public sealed partial class TrackDetailViewModel : CatalogDetailViewModel
{
    private readonly Guid _id;
    private Guid _artistId;
    private Guid? _albumId;

    public TrackDetailViewModel(CatalogPageContext context, Guid id, string title)
        : base(context, title)
    {
        ArgumentNullException.ThrowIfNull(context);
        _id = id;
        Repairs = new TrackRepairer(context.Actions, context.Dialogs, context.Sdk).Menu(id, detail =>
        {
            Notice = detail;

            // What the repair changed is on this page, so it is read again.
            _ = LoadCommand.ExecuteAsync(null);
        });
    }

    public EnrichmentViewModel Enrichment { get; } = new(
        "No provider has been asked about this record yet. The enrichment pass picks up what it has not seen, oldest first.");

    public IReadOnlyList<MenuChoiceViewModel> Repairs { get; }

    public ObservableCollection<CopyRowViewModel> Copies { get; } = [];

    public ObservableCollection<FigureViewModel> Measurement { get; } = [];

    public ObservableCollection<AiringRowViewModel> Airings { get; } = [];

    /// <summary>The station's own account of the last repair.</summary>
    [ObservableProperty]
    private string? _notice;

    [ObservableProperty]
    private string? _noCopies;

    [ObservableProperty]
    private StatusTone _measurementTone = StatusTone.Off;

    [ObservableProperty]
    private string? _measurementState;

    [ObservableProperty]
    private string? _unmeasured;

    [ObservableProperty]
    private string? _playCount;

    [ObservableProperty]
    private string? _neverAired;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasAlbum))]
    private string? _albumName;

    [ObservableProperty]
    private string? _artistName;

    public bool HasAlbum => AlbumName is not null;

    [RelayCommand]
    private void OpenArtist()
    {
        if (ArtistName is { } name)
        {
            Context.Navigation.Push(new Navigation.Destination.ArtistDetail(_artistId, name));
        }
    }

    [RelayCommand]
    private void OpenAlbum()
    {
        if (_albumId is { } album && AlbumName is { } name)
        {
            Context.Navigation.Push(new Navigation.Destination.AlbumDetail(album, name));
        }
    }

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var track = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.GetTrackAsync(_id, token).ConfigureAwait(false);
            },
            new Dictionary<int, string> { [404] = "No record with that id is in the catalog." },
            cancellationToken).ConfigureAwait(true);

        if (track is null)
        {
            Problem = "This record could not be read.";
            return;
        }

        Present(track);

        var enrichment = await Context.Actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Catalog.GetTrackEnrichmentAsync(_id, token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (enrichment is not null)
        {
            Enrichment.Reading = EnrichmentReading.From(enrichment);
        }
    }

    /// <summary>Draws the record the station answered with. Public so a frame can be posed from one.</summary>
    public void Present(TrackDetail track)
    {
        ArgumentNullException.ThrowIfNull(track);

        Name = track.Title;
        _artistId = track.ArtistId;
        _albumId = track.AlbumId;
        ArtistName = track.ArtistName;
        AlbumName = track.AlbumId is null ? null : track.AlbumName;

        // The year is the tag on the file itself, which is what the station's own period filter
        // reads, and can disagree with the providers' "released" below it.
        Credit = TrackFacts.Credit(track.Artists, track.AlbumName, track.Year, track.DurationMs);
        ArtworkUrl = Context.Station.ArtUrl(track.AlbumImageUrl);
        Rating = CatalogRatings.Track(Context.Actions, Sdk, track.Id, track.Rating, track.Title);

        Copies.Clear();
        foreach (var binding in track.Bindings)
        {
            var status = TrackFacts.Status(binding);
            Copies.Add(new CopyRowViewModel(
                binding.PluginId,
                binding.ExternalId,
                binding.Origin == "discovered",
                status.Tone,
                status.Label,
                status.Detail,
                TrackFacts.Format(binding),
                TrackFacts.Bytes(binding.ByteSize),
                TrackFacts.When(binding.LastServedAt)));
        }

        NoCopies = Copies.Count == 0
            ? "No provider holds a copy of this record, so nothing can play it. That is usually an import whose lookup never resolved."
            : null;

        Measurement.Clear();
        if (track.Analysis is { } analysis)
        {
            (MeasurementTone, MeasurementState) = TrackFacts.Measurement(analysis);
            Measurement.Add(new("Last measured", TrackFacts.When(analysis.AnalyzedAt)));
            Measurement.Add(new("By", analysis.Analyzer ?? analysis.AnalyzerPluginId ?? "—"));
            Measurement.Add(new("Schema", analysis.SchemaVersion.ToString(System.Globalization.CultureInfo.InvariantCulture)));
            if (analysis.FailureReason is { } reason)
            {
                Measurement.Add(new("Why it failed", reason));
            }

            Unmeasured = null;
        }
        else
        {
            MeasurementState = null;
            Unmeasured = "Nothing has measured this record yet. It plays perfectly well unmeasured; without the measurement the station cannot trim the silence off either end or set the level before air.";
        }

        Airings.Clear();
        foreach (var play in track.Plays)
        {
            Airings.Add(new AiringRowViewModel(TrackFacts.When(play.AiredAt), play.Source));
        }

        PlayCount = track.PlayCount == 1 ? "1 in all" : $"{track.PlayCount} in all";
        NeverAired = Airings.Count == 0 ? "This record has not been on air yet." : null;
    }
}
