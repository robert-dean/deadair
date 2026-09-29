using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One writer's go at a rehearsed break.</summary>
public sealed record RehearsalAttemptViewModel(string Writer, string Duration, string Text, bool Wrote, StatusTone Tone);

/// <summary>
/// One break written in a character's voice, between two invented records, that never airs.
/// </summary>
/// <remarks>
/// <para>
/// It rehearses what is SAVED. The station's rehearsal reads the stored row and there is no endpoint
/// that would speak a draft, so a button claiming to include unsaved edits would be the page lying
/// about what somebody is hearing. It changes nothing and spends one generation, which is why it is a
/// plain button rather than a question, and why only one runs at a time.
/// </para>
/// <para>
/// The records either side are fixed by the station, so two readings of the same sheet can be
/// compared.
/// </para>
/// </remarks>
public sealed partial class PersonaRehearsalViewModel(
    OperatorActions actions,
    HttpClient http,
    PreviewsViewModel previews,
    string personaId,
    string? voice) : VoiceTabViewModel(actions, http)
{
    public ObservableCollection<RehearsalAttemptViewModel> Attempts { get; } = [];

    /// <summary>Which two records the break sat between, or null before one has been asked for.</summary>
    [ObservableProperty]
    private string? _between;

    /// <summary>What won, which is the only thing with anything to say out loud.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanHear))]
    private string? _script;

    /// <summary>Why this break would be skipped on air, when nothing wrote it.</summary>
    [ObservableProperty]
    private string? _skipped;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HearLabel))]
    private bool _isPlaying;

    public bool CanHear => Script is not null;

    public string HearLabel => IsPlaying ? "Stop" : "Hear this break";

    /// <summary>Nothing is read until somebody asks: a rehearsal spends a generation.</summary>
    protected override Task ReadAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    [RelayCommand]
    private async Task RehearseAsync(CancellationToken cancellationToken)
    {
        if (Busy)
        {
            return;
        }

        Busy = true;
        try
        {
            var rehearsal = await RunAsync((sdk, token) => sdk.Personas.RehearsePersonaAsync(personaId, token), cancellationToken: cancellationToken)
                .ConfigureAwait(true);

            if (rehearsal is not null)
            {
                Present(rehearsal);
            }
        }
        finally
        {
            Busy = false;
        }
    }

    public void Present(PersonaRehearsal rehearsal)
    {
        ArgumentNullException.ThrowIfNull(rehearsal);

        Between = $"between {rehearsal.Previous} and {rehearsal.Next}";
        Script = rehearsal.Script;
        Skipped = rehearsal.Script is null && rehearsal.Reason is { } reason
            ? $"{reason}. On air this break would be skipped, and the station would go straight to the next record."
            : rehearsal.Attempts.Count == 0 ? "Nothing writes a talk break on this station." : null;

        Attempts.Clear();
        foreach (var attempt in rehearsal.Attempts)
        {
            Attempts.Add(Attempt(attempt));
        }
    }

    public static RehearsalAttemptViewModel Attempt(PersonaRehearsalAttempt attempt)
    {
        ArgumentNullException.ThrowIfNull(attempt);

        return new RehearsalAttemptViewModel(
            attempt.Writer,
            $"{attempt.DurationMs.ToString(CultureInfo.InvariantCulture)}ms",
            attempt.Script ?? attempt.Reason ?? "nothing to say",
            attempt.Script is not null,
            attempt.Outcome switch
            {
                "written" => StatusTone.Ok,
                "failed" => StatusTone.Fault,
                _ => StatusTone.Standby,
            });
    }

    /// <summary>Speaks the winning break in the character's voice, over the station.</summary>
    [RelayCommand]
    private async Task HearAsync()
    {
        if (Script is not { } script)
        {
            return;
        }

        await previews.ToggleAsync(
            HearKey,
            async token => Clips.From(await RunAsync<object>(
                async (sdk, inner) => await sdk.Render.PreviewSpeechAsync(new SpeechPreviewRequest { Text = script, Voice = voice }, inner)
                    .ConfigureAwait(false),
                cancellationToken: token).ConfigureAwait(true))).ConfigureAwait(true);

        IsPlaying = previews.Playing == HearKey;
    }

    private string HearKey => $"rehearsal:{personaId}";
}
