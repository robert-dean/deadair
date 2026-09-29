using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Auth;
using MaroonedSoftware.Deadair.Desktop.Core.Text;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One thing the station tried to say, with what an operator made of it.</summary>
public sealed partial class ScriptRowViewModel(string when, string kind, string writer, string text, StatusTone tone) : ObservableObject
{
    public string When { get; } = when;

    public string Kind { get; } = kind;

    public string Writer { get; } = writer;

    public string Text { get; } = text;

    public StatusTone Tone { get; } = tone;

    /// <summary>The attempt behind the row, or null for one posed without one.</summary>
    public ScriptAttempt? Attempt { get; init; }

    /// <summary>
    /// Only where there are words to have an opinion about: asking what somebody thought of a sentence
    /// that was never written is a question with no subject.
    /// </summary>
    public bool CanRate => Attempt?.Script is not null;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsLiked), nameof(IsNeutral), nameof(IsDisliked))]
    private ScriptRating? _rating;

    public bool IsLiked => Rating == ScriptRating.Liked;

    public bool IsNeutral => Rating == ScriptRating.Neutral;

    public bool IsDisliked => Rating == ScriptRating.Disliked;

    /// <summary>Whether the detail under the row is open. Built only when it is, since a prompt runs to thousands of words.</summary>
    [ObservableProperty]
    private bool _isOpen;

    public string? Detail => Attempt is null ? null : ScriptsViewModel.DetailOf(Attempt);

    [RelayCommand]
    private void Toggle() => IsOpen = !IsOpen;
}

/// <summary>
/// What the station said, or tried to: one row per ATTEMPT rather than per segment.
/// </summary>
/// <remarks>
/// <para>
/// That is the point of the endpoint: a model that declined and the floor that covered for it are two
/// facts, and one row would hide the more interesting of them.
/// </para>
/// <para>
/// It can be narrowed to one character or one break, from the character's card or the segment's row,
/// and says what it is narrowed to rather than only offering to clear it: somebody who followed a link
/// and paged through has to be able to tell this from the whole history.
/// </para>
/// </remarks>
public sealed partial class ScriptsViewModel(OperatorActions actions, HttpClient http) : VoiceTabViewModel(actions, http)
{
    private const long PageSize = 60;

    private string? _before;

    public ObservableCollection<ScriptRowViewModel> Scripts { get; } = [];

    public static IReadOnlyList<ChoiceViewModel> Outcomes { get; } =
    [
        new(string.Empty, "Everything"),
        new("written", "Written"),
        new("declined", "Declined"),
        new("failed", "Failed"),
    ];

    /// <summary>The two writers the station has, by their own names.</summary>
    public static IReadOnlyList<ChoiceViewModel> Writers { get; } =
    [
        new(string.Empty, "Any writer"),
        new("model", "Model"),
        new("deterministic", "Floor"),
    ];

    [ObservableProperty]
    private ChoiceViewModel _outcome = Outcomes[0];

    [ObservableProperty]
    private ChoiceViewModel _writer = Writers[0];

    /// <summary>The character this is narrowed to, by the key the history stamps, or null.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Narrowed), nameof(IsNarrowed))]
    private string? _personaKey;

    /// <summary>The break this is narrowed to, or null.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Narrowed), nameof(IsNarrowed))]
    private string? _segmentId;

    /// <summary>Whether there is an older page to read.</summary>
    [ObservableProperty]
    private bool _hasMore;

    public bool IsNarrowed => PersonaKey is not null || SegmentId is not null;

    public string Narrowed => SegmentId is not null
        ? "Every attempt at writing this one break, including the ones that came to nothing."
        : PersonaKey is not null
            ? $"Everything {PersonaKey} has said. A run of declines with the floor writing underneath is what a sheet nothing can satisfy looks like."
            : "Everything the station has written, newest first. A model that declined and the line that went out instead are both here.";

    public string? Empty => Scripts.Count > 0 || Busy ? null
        : Outcome.Value.Length > 0 || Writer.Value.Length > 0 ? "Nothing matches that filter."
        : SegmentId is not null ? "Nothing has been written for this break yet. The station asks for the words as the slot comes near."
        : PersonaKey is not null ? "This character has not written anything yet."
        : "Nothing yet. The station writes here every time it makes a break, whether or not the words made it to air.";

    /// <summary>Narrows to one character and reads again. Asked for by a character's card.</summary>
    public void NarrowToPersona(string key)
    {
        SegmentId = null;
        PersonaKey = key;
    }

    /// <summary>Narrows to one break. Asked for by a segment's row.</summary>
    public void NarrowToSegment(string id)
    {
        PersonaKey = null;
        SegmentId = id;
    }

    [RelayCommand]
    private Task WidenAsync()
    {
        PersonaKey = null;
        SegmentId = null;
        return LoadAsync(CancellationToken.None);
    }

    partial void OnOutcomeChanged(ChoiceViewModel value) => _ = LoadAsync(CancellationToken.None);

    partial void OnWriterChanged(ChoiceViewModel value) => _ = LoadAsync(CancellationToken.None);

    protected override Task ReadAsync(CancellationToken cancellationToken) => ReadPageAsync(older: false, cancellationToken);

    [RelayCommand]
    private Task OlderAsync() => ReadPageAsync(older: true, CancellationToken.None);

    private async Task ReadPageAsync(bool older, CancellationToken cancellationToken)
    {
        var query = new ScriptHistoryQuery
        {
            Limit = PageSize,
            Before = older ? _before : null,
            Outcome = Outcome.Value.Length == 0 ? null : Core.Voicing.Wire.Parse<ScriptOutcome>(Outcome.Value),
            Writer = Writer.Value.Length == 0 ? null : Writer.Value,
            PersonaKey = PersonaKey,
            SegmentId = SegmentId,
        };

        var page = await RunAsync((sdk, token) => sdk.Render.ReadScriptHistoryAsync(query, token), cancellationToken: cancellationToken)
            .ConfigureAwait(true);

        if (page is null)
        {
            return;
        }

        if (!older)
        {
            Scripts.Clear();
        }

        foreach (var attempt in page.Attempts)
        {
            Scripts.Add(Row(attempt));
        }

        _before = page.NextBefore;
        HasMore = page.NextBefore is not null;
        OnPropertyChanged(nameof(Empty));
    }

    public static ScriptRowViewModel Row(ScriptAttempt attempt)
    {
        ArgumentNullException.ThrowIfNull(attempt);

        return new ScriptRowViewModel(
            attempt.At.ToLocalTime().ToString("d MMM HH:mm", CultureInfo.CurrentCulture),
            attempt.Kind,
            attempt.Writer,
            attempt.Script ?? attempt.Reason ?? "(nothing was written)",
            attempt.Outcome switch
            {
                ScriptOutcome.Written => StatusTone.Ok,
                ScriptOutcome.Declined => StatusTone.Standby,
                _ => StatusTone.Fault,
            })
        {
            Attempt = attempt,
            Rating = attempt.Rating,
        };
    }

    /// <summary>What there is to know about an attempt beyond its words, as plain lines.</summary>
    public static string DetailOf(ScriptAttempt attempt)
    {
        ArgumentNullException.ThrowIfNull(attempt);

        var lines = new List<string> { $"Kind: {attempt.Kind}" };
        if (attempt.PersonaKey is { } host)
        {
            lines.Add($"Host: {host}");
        }

        if (attempt.Model is { } model)
        {
            lines.Add($"Model: {model}");
        }

        if (attempt.Source is { } source)
        {
            lines.Add($"From: {source}");
        }

        if (attempt.DurationMs is { } ms)
        {
            lines.Add(string.Create(CultureInfo.InvariantCulture, $"Took: {ms / 1000d:0.0}s"));
        }

        if ((attempt.Usage?.TotalTokens ?? attempt.Usage?.OutputTokens) is { } tokens)
        {
            lines.Add($"Tokens: {tokens}");
        }

        if (attempt.Previous is { } previous)
        {
            lines.Add($"After: {previous.Title}, {previous.Artist}");
        }

        if (attempt.Next is { } next)
        {
            lines.Add($"Before: {next.Title}, {next.Artist}");
        }

        if (attempt.Reason is { } reason && attempt.Script is not null)
        {
            lines.Add($"Note: {reason}");
        }

        if (attempt.Raw is { } raw)
        {
            lines.Add(string.Empty);
            lines.Add("The answer, before anything read it:");
            lines.Add(raw);
        }

        lines.Add(string.Empty);
        if (attempt.Prompt is { Count: > 0 } prompt)
        {
            lines.Add("What it was sent:");
            foreach (var message in prompt)
            {
                lines.Add($"{message.Role.ToUpperInvariant()}: {message.Content}");
            }
        }
        else
        {
            lines.Add("The prompt was not kept. Turn on llm.captureWrites to keep it for the attempts after this one.");
        }

        return string.Join('\n', lines);
    }

    [RelayCommand]
    private Task LikeAsync(ScriptRowViewModel row) => RateAsync(row, ScriptRating.Liked);

    [RelayCommand]
    private Task NeutralAsync(ScriptRowViewModel row) => RateAsync(row, ScriptRating.Neutral);

    [RelayCommand]
    private Task DislikeAsync(ScriptRowViewModel row) => RateAsync(row, ScriptRating.Disliked);

    /// <summary>Tells the station what somebody made of a line, which it reads as a preference, never as a rule.</summary>
    private async Task RateAsync(ScriptRowViewModel row, ScriptRating rating)
    {
        ArgumentNullException.ThrowIfNull(row);

        if (row.Attempt is not { } attempt || !Guid.TryParse(attempt.Id, out var id))
        {
            return;
        }

        var rated = await RunAsync((sdk, token) => sdk.Render.RateScriptAsync(id, new ScriptRatingInput { Rating = rating }, token)).ConfigureAwait(true);
        if (rated is not null)
        {
            row.Rating = rated.Rating;
        }
    }
}
