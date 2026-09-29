using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Core.Voicing;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>Something to pick from a list: what is sent, and what is read.</summary>
public sealed record ChoiceViewModel(string Value, string Label, string? Extra = null);

/// <summary>One transition of an audition: the two records, and everything the writers said between them.</summary>
public sealed partial class AuditionBreakViewModel(PersonaAuditionBreak written) : ObservableObject
{
    public PersonaAuditionBreak Break { get; } = written;

    public string Heading => $"{Break.Ordinal + 1}  between {Break.Previous.Title} and {Break.Next.Title}";

    public IReadOnlyList<RehearsalAttemptViewModel> Attempts { get; } = [.. written.Attempts.Select(PersonaRehearsalViewModel.Attempt)];

    public bool CanHear => Break.Script is not null;

    public string? Skipped => Break.Script is null && Break.Reason is { } reason
        ? $"{reason}. On air this break would be skipped, and the station would go straight to the next record."
        : null;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HearLabel))]
    private bool _isPlaying;

    public string HearLabel => IsPlaying ? "Stop" : "Hear";
}

/// <summary>One run of a character through a playlist.</summary>
public sealed partial class AuditionRunViewModel(PersonaAuditionSummary run) : ObservableObject
{
    public PersonaAuditionSummary Run { get; private set; } = run;

    public string Id => Run.Id;

    public string State => AuditionText.Label(Run.State);

    public StatusTone Tone => AuditionText.Tone(Run.State);

    public string Progress => $"{Run.Written} / {Run.Transitions}";

    public string Source => $"{Run.Source.Name ?? Run.Source.PlaylistId} · {Run.Source.PluginId}";

    public string? Error => Run.Error;

    public bool Unsettled => AuditionText.Unsettled(Run.State);

    /// <summary>Said while nothing has been written yet, because a run fills in slowly by design.</summary>
    public bool IsQueued => Run.Written == 0 && Unsettled;

    public bool CanRead => Run.Written > 0;

    public ObservableCollection<AuditionBreakViewModel> Breaks { get; } = [];

    /// <summary>The breaks are read only when the run is opened: a list of twenty runs must not read every break of each.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ReadLabel))]
    private bool _isOpen;

    [ObservableProperty]
    private string? _tally;

    public string ReadLabel => IsOpen ? "Hide" : "Read";

    /// <summary>Takes a newer reading of the same run without losing whether it is open.</summary>
    public void Update(PersonaAuditionSummary run)
    {
        Run = run;
        OnPropertyChanged(string.Empty);
    }

    public void Present(PersonaAudition audition)
    {
        ArgumentNullException.ThrowIfNull(audition);

        Breaks.Clear();
        foreach (var written in audition.Breaks)
        {
            Breaks.Add(new AuditionBreakViewModel(written));
        }

        Tally = AuditionText.Tally(audition.Breaks);
    }
}

/// <summary>
/// A character over an hour of real records, before it goes on air.
/// </summary>
/// <remarks>
/// <para>
/// The rehearsal on a character's page writes ONE break between two fixed invented records, which is
/// right for judging an edit and wrong for this question: does the character hold up over real
/// material, and does the model start declining once there are facts in front of it? So this runs the
/// same writers over a playlist, one break per transition, and airs none of it.
/// </para>
/// <para>
/// It polls, and only while a run is still going: the station's own jobs carry a run on without
/// anybody watching, and the tab asks again every few seconds only for as long as the answer can
/// change and somebody is looking at it. Leaving the page, or the run settling, stops it.
/// </para>
/// </remarks>
public sealed partial class AuditionsViewModel(OperatorActions actions, HttpClient http, PreviewsViewModel previews)
    : VoiceTabViewModel(actions, http)
{
    private static readonly TimeSpan PollEvery = TimeSpan.FromSeconds(5);

    private readonly List<Persona> _hosts = [];
    /// <summary>Which poll is the live one. Leaving moves it on, so a wait already under way finds itself stale and stops.</summary>
    private int _generation;

    private bool _polling;

    public ObservableCollection<ChoiceViewModel> Hosts { get; } = [];

    public ObservableCollection<ChoiceViewModel> Playlists { get; } = [];

    public ObservableCollection<AuditionRunViewModel> Runs { get; } = [];

    [ObservableProperty]
    private ChoiceViewModel? _host;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(StartCommand))]
    private ChoiceViewModel? _playlist;

    [ObservableProperty]
    private decimal? _breaks = AuditionText.DefaultBreaks;

    public string? Empty => Runs.Count > 0 || Host is null ? null
        : $"{Host.Label} has not been auditioned yet. Pick a playlist above and press Start. Ten breaks is about an hour of radio, "
            + "and you can read them as they land.";

    protected override async Task ReadAsync(CancellationToken cancellationToken)
    {
        var roster = await RunAsync((sdk, token) => sdk.Personas.ListPersonasAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);
        var playlists = await RunAsync((sdk, token) => sdk.Playlists.ListImportablePlaylistsAsync(token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (roster is not null)
        {
            PresentHosts(roster.Personas);
        }

        if (playlists is not null)
        {
            PresentPlaylists(playlists.Playlists);
        }

        await ReadRunsAsync(cancellationToken).ConfigureAwait(true);
    }

    /// <summary>Hosts only: a caller can never be put on air, so it is never auditioned for it.</summary>
    public void PresentHosts(IEnumerable<Persona> roster)
    {
        ArgumentNullException.ThrowIfNull(roster);

        var chosen = Host?.Value;
        _hosts.Clear();
        _hosts.AddRange(roster.Where(persona => PersonaRoster.KindOf(persona) == PersonaKind.Host));

        Hosts.Clear();
        foreach (var host in _hosts)
        {
            Hosts.Add(new ChoiceViewModel(host.Id, host.Presenting ? $"{host.Label} (on air)" : host.Label));
        }

        // Whoever is on air unless somebody has chosen otherwise, since that is the character most
        // worth hearing over real records.
        Host = Hosts.FirstOrDefault(choice => choice.Value == chosen)
            ?? Hosts.FirstOrDefault(choice => _hosts.First(host => host.Id == choice.Value).Presenting)
            ?? Hosts.FirstOrDefault();
    }

    public void PresentPlaylists(IEnumerable<CatalogPlaylist> playlists)
    {
        ArgumentNullException.ThrowIfNull(playlists);

        var chosen = Playlist?.Value;
        Playlists.Clear();
        foreach (var playlist in playlists.Where(AuditionText.Offerable))
        {
            Playlists.Add(new ChoiceViewModel($"{playlist.PluginId}\n{playlist.Id}", $"{playlist.Name} · {playlist.PluginName}", playlist.Name));
        }

        Playlist = Playlists.FirstOrDefault(choice => choice.Value == chosen);
    }

    partial void OnHostChanged(ChoiceViewModel? value)
    {
        Runs.Clear();
        OnPropertyChanged(nameof(Empty));
        StartCommand.NotifyCanExecuteChanged();
        if (value is not null && !Busy)
        {
            _ = ReadRunsAsync(CancellationToken.None);
        }
    }

    private async Task ReadRunsAsync(CancellationToken cancellationToken)
    {
        if (Host is not { } host)
        {
            return;
        }

        var list = await RunAsync((sdk, token) => sdk.PersonasAuditions.ListPersonaAuditionsAsync(host.Value, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (list is null || Host?.Value != host.Value)
        {
            return;
        }

        PresentRuns(list.Auditions);
        foreach (var open in Runs.Where(run => run.IsOpen && run.Unsettled))
        {
            await ReadBreaksAsync(open, cancellationToken).ConfigureAwait(true);
        }

        KeepPolling();
    }

    /// <summary>Draws the runs, keeping each open one open.</summary>
    public void PresentRuns(IEnumerable<PersonaAuditionSummary> runs)
    {
        ArgumentNullException.ThrowIfNull(runs);

        var kept = Runs.ToDictionary(run => run.Id);
        Runs.Clear();
        foreach (var run in runs)
        {
            if (kept.TryGetValue(run.Id, out var existing))
            {
                existing.Update(run);
                Runs.Add(existing);
            }
            else
            {
                Runs.Add(new AuditionRunViewModel(run));
            }
        }

        OnPropertyChanged(nameof(Empty));
    }

    /// <summary>Starts the timer if a run can still change, and stops it once none can.</summary>
    private void KeepPolling()
    {
        if (!Runs.Any(run => run.Unsettled))
        {
            Leave();
            return;
        }

        if (_polling)
        {
            return;
        }

        _polling = true;
        _ = PollAsync(_generation);
    }

    private async Task PollAsync(int generation)
    {
        await Task.Delay(PollEvery).ConfigureAwait(true);
        if (generation != _generation)
        {
            return;
        }

        _polling = false;
        await ReadRunsAsync(CancellationToken.None).ConfigureAwait(true);
    }

    public override void Leave()
    {
        _generation++;
        _polling = false;
    }

    [RelayCommand(CanExecute = nameof(CanStart))]
    private async Task StartAsync()
    {
        if (Host is not { } host || Playlist is not { } playlist)
        {
            return;
        }

        var parts = playlist.Value.Split('\n');
        var limit = (long)Math.Clamp(Breaks ?? AuditionText.DefaultBreaks, 1, AuditionText.MostBreaks);
        var started = await RunAsync((sdk, token) => sdk.PersonasAuditions.StartPersonaAuditionAsync(
            host.Value,
            new PersonaAuditionRequest { PluginId = parts[0], PlaylistId = parts[1], Name = playlist.Extra, Limit = limit },
            token)).ConfigureAwait(true);

        if (started is not null)
        {
            Notice = "Started. Nothing here airs, and each break waits for the model behind everything the station is doing for itself.";
            await ReadRunsAsync(CancellationToken.None).ConfigureAwait(true);
        }
    }

    private bool CanStart() => Host is not null && Playlist is not null;

    /// <summary>Stops a run. What it wrote stays readable; nothing it wrote ever aired.</summary>
    [RelayCommand]
    private async Task StopAsync(AuditionRunViewModel run)
    {
        ArgumentNullException.ThrowIfNull(run);

        if (Host is not { } host)
        {
            return;
        }

        var stopped = await RunAsync((sdk, token) => sdk.PersonasAuditions.CancelPersonaAuditionAsync(host.Value, run.Id, token)).ConfigureAwait(true);
        if (stopped is not null)
        {
            run.Update(stopped);
            KeepPolling();
        }
    }

    [RelayCommand]
    private async Task OpenRunAsync(AuditionRunViewModel run)
    {
        ArgumentNullException.ThrowIfNull(run);

        run.IsOpen = !run.IsOpen;
        if (run.IsOpen)
        {
            await ReadBreaksAsync(run, CancellationToken.None).ConfigureAwait(true);
        }
    }

    private async Task ReadBreaksAsync(AuditionRunViewModel run, CancellationToken cancellationToken)
    {
        if (Host is not { } host)
        {
            return;
        }

        var audition = await RunAsync((sdk, token) => sdk.PersonasAuditions.GetPersonaAuditionAsync(host.Value, run.Id, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);
        if (audition is not null)
        {
            run.Present(audition);
        }
    }

    /// <summary>Speaks a written break in the character's voice: what a character sounds like is what is being judged.</summary>
    [RelayCommand]
    private async Task HearAsync(AuditionBreakViewModel written)
    {
        ArgumentNullException.ThrowIfNull(written);

        if (written.Break.Script is not { } script)
        {
            return;
        }

        var voice = _hosts.FirstOrDefault(host => host.Id == Host?.Value)?.Voice;
        var key = $"audition:{written.Break.Ordinal}:{script.GetHashCode(StringComparison.Ordinal)}";
        await previews.ToggleAsync(
            key,
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.PreviewSpeechAsync(new SpeechPreviewRequest { Text = script, Voice = voice }, inner)
                    .ConfigureAwait(false),
                cancellationToken: token).ConfigureAwait(true))).ConfigureAwait(true);

        written.IsPlaying = previews.Playing == key;
    }
}
