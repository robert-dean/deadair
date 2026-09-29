using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Catalog;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// The card on an act's, a release's or a record's page saying what the providers said about it.
/// </summary>
/// <remarks>
/// A biography is long and is read occasionally, so it opens at four lines with Read more; the
/// fields no name exists for are raw JSON behind a toggle, because that is a debugging affordance and
/// not something anybody reads while looking at a record.
/// </remarks>
public sealed partial class EnrichmentViewModel(string emptyText) : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasReading), nameof(IsEmpty))]
    private EnrichmentReading? _reading;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(BiographyLines), nameof(BiographyToggle))]
    private bool _biographyOpen;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(UnmappedToggle))]
    private bool _unmappedOpen;

    /// <summary>What to say when nobody has been asked about this one yet. It names the kind of thing.</summary>
    public string EmptyText { get; } = emptyText;

    public bool HasReading => Reading is { IsEmpty: false };

    public bool IsEmpty => Reading is { IsEmpty: true };

    public int BiographyLines => BiographyOpen ? int.MaxValue : 4;

    public string BiographyToggle => BiographyOpen ? "Show less" : "Read more";

    public string UnmappedToggle => UnmappedOpen ? "Hide the unmapped fields" : "Show the unmapped fields";

    [RelayCommand]
    private void ToggleBiography() => BiographyOpen = !BiographyOpen;

    [RelayCommand]
    private void ToggleUnmapped() => UnmappedOpen = !UnmappedOpen;
}
