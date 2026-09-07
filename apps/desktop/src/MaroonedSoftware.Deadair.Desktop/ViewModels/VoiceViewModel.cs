using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Station;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk;
using MaroonedSoftware.Deadair.Sdk.Models;
using MaroonedSoftware.Deadair.Sdk.Runtime;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One of the station's presenters.</summary>
public sealed record PersonaRowViewModel(string Id, string Label, string Style, bool Active);

/// <summary>One thing the station tried to say.</summary>
public sealed record ScriptRowViewModel(string When, string Kind, string Writer, string Text, StatusTone Tone);

/// <summary>One piece of audio the station holds.</summary>
public sealed record SegmentRowViewModel(string Label, string Kind, string State, StatusTone Tone);

/// <summary>One programme being made.</summary>
public sealed record ProductionRowViewModel(string Id, string Title, string Kind, string State, bool CanCancel);

/// <summary>Which part of the voice page is showing.</summary>
public enum VoiceTab
{
    Characters,
    Said,
    Segments,
    Productions,
}

/// <summary>
/// Who the station is, and what it has said.
/// </summary>
/// <remarks>
/// Four readings rather than the console's eight tabs. The four here are the ones that answer a
/// question somebody actually asks of a running station: who is presenting, what did it say, what
/// audio does it hold, and what is being made right now. Voices, pronunciations, pads and topics are
/// configuration rather than observation, and are left for later.
/// </remarks>
public sealed partial class VoiceViewModel(OperatorActions actions, HttpClient http) : ObservableObject
{
    private StationUrl _station;

    public ObservableCollection<PersonaRowViewModel> Personas { get; } = [];

    public ObservableCollection<ScriptRowViewModel> Scripts { get; } = [];

    public ObservableCollection<SegmentRowViewModel> Segments { get; } = [];

    public ObservableCollection<ProductionRowViewModel> Productions { get; } = [];

    [ObservableProperty]
    private VoiceTab _tab = VoiceTab.Characters;

    [ObservableProperty]
    private bool _busy;

    [ObservableProperty]
    private string? _notice;

    public bool IsCharacters => Tab == VoiceTab.Characters;

    public bool IsSaid => Tab == VoiceTab.Said;

    public bool IsSegments => Tab == VoiceTab.Segments;

    public bool IsProductions => Tab == VoiceTab.Productions;

    public void Attach(StationUrl station) => _station = station;

    partial void OnTabChanged(VoiceTab value)
    {
        OnPropertyChanged(nameof(IsCharacters));
        OnPropertyChanged(nameof(IsSaid));
        OnPropertyChanged(nameof(IsSegments));
        OnPropertyChanged(nameof(IsProductions));

        _ = LoadAsync(CancellationToken.None);
    }

    [RelayCommand]
    private void ShowTab(string tab)
    {
        if (Enum.TryParse<VoiceTab>(tab, out var parsed))
        {
            Tab = parsed;
        }
    }

    [RelayCommand]
    private async Task LoadAsync(CancellationToken cancellationToken)
    {
        Busy = true;
        try
        {
            switch (Tab)
            {
                case VoiceTab.Characters:
                    await LoadPersonasAsync(cancellationToken).ConfigureAwait(true);
                    break;
                case VoiceTab.Said:
                    await LoadScriptsAsync(cancellationToken).ConfigureAwait(true);
                    break;
                case VoiceTab.Segments:
                    await LoadSegmentsAsync(cancellationToken).ConfigureAwait(true);
                    break;
                case VoiceTab.Productions:
                    await LoadProductionsAsync(cancellationToken).ConfigureAwait(true);
                    break;
            }
        }
        finally
        {
            Busy = false;
        }
    }

    private async Task LoadPersonasAsync(CancellationToken cancellationToken)
    {
        var list = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Personas.ListPersonasAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        Personas.Clear();
        foreach (var persona in list.Personas)
        {
            Personas.Add(new PersonaRowViewModel(persona.Id, persona.Label, persona.Style, persona.Active));
        }
    }

    private async Task LoadScriptsAsync(CancellationToken cancellationToken)
    {
        var page = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Render.ReadScriptHistoryAsync(new ScriptHistoryQuery { Limit = 60 }, token)
                    .ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        Scripts.Clear();
        foreach (var attempt in page.Attempts)
        {
            // One row per ATTEMPT rather than per segment, which is the point of the endpoint: a
            // model that declined and the floor that covered for it are two facts, not one
            // misleading one.
            Scripts.Add(new ScriptRowViewModel(
                attempt.At.ToLocalTime().ToString("HH:mm", CultureInfo.InvariantCulture),
                attempt.Kind,
                attempt.Writer,
                attempt.Script ?? attempt.Reason ?? "(nothing was written)",
                attempt.Outcome switch
                {
                    ScriptOutcome.Written => StatusTone.Ok,
                    ScriptOutcome.Declined => StatusTone.Standby,
                    _ => StatusTone.Fault,
                }));
        }
    }

    private async Task LoadSegmentsAsync(CancellationToken cancellationToken)
    {
        var list = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Render.ListSegmentsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        Segments.Clear();
        foreach (var segment in list.Segments)
        {
            // `ready` alone can air. Everything before it is a stage of being made, and drawing those
            // as faults would make an ordinary pipeline look broken.
            Segments.Add(new SegmentRowViewModel(
                segment.Label,
                segment.Kind,
                segment.State.ToString().ToLowerInvariant(),
                segment.State switch
                {
                    SegmentState.Ready => StatusTone.Ok,
                    SegmentState.Failed => StatusTone.Fault,
                    _ => StatusTone.Standby,
                }));
        }
    }

    private async Task LoadProductionsAsync(CancellationToken cancellationToken)
    {
        var list = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Productions.ListProductionsAsync(token).ConfigureAwait(false);
            },
            cancellationToken: cancellationToken).ConfigureAwait(true);

        if (list is null)
        {
            return;
        }

        Productions.Clear();
        foreach (var production in list.Productions)
        {
            var state = production.State.ToString().ToLowerInvariant();

            Productions.Add(new ProductionRowViewModel(
                production.Id,
                production.Title,
                production.Kind,
                state,
                // Anything short of ready or finished is still being made, and only that can be
                // called off. Listing the states that CAN be cancelled rather than the ones that
                // cannot means a new stage added upstream is not silently cancellable.
                production.State is ProductionState.Planned
                    or ProductionState.Outlining
                    or ProductionState.Drafting
                    or ProductionState.Checking
                    or ProductionState.Rendering
                    or ProductionState.Stitching));
        }
    }

    [RelayCommand]
    private async Task PutOnAirAsync(PersonaRowViewModel persona)
    {
        ArgumentNullException.ThrowIfNull(persona);

        var list = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Personas.PutPersonaOnAirAsync(persona.Id, token).ConfigureAwait(false);
            }).ConfigureAwait(true);

        if (list is not null)
        {
            Notice = $"{persona.Label} is presenting.";
            await LoadPersonasAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    [RelayCommand]
    private async Task CancelProductionAsync(ProductionRowViewModel production)
    {
        ArgumentNullException.ThrowIfNull(production);

        var cancelled = await actions.RunAsync(
            async token =>
            {
                using var sdk = Sdk();
                return await sdk.Productions.CancelProductionAsync(production.Id, token).ConfigureAwait(false);
            }).ConfigureAwait(true);

        if (cancelled is not null)
        {
            Notice = $"Cancelled {production.Title}.";
            await LoadProductionsAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    private DeadairSdk Sdk() => new(new SdkOptions
    {
        BaseUrl = _station.ApiBase,
        HttpClient = http,
    });
}
