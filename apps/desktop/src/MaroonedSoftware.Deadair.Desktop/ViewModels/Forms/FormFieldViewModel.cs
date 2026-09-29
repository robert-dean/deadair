using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// One field of a declared form, drawn by the view that matches its type.
/// </summary>
/// <remarks>
/// Nothing here knows what any field means. The station or the plugin declared its key, label, type,
/// bounds and help, and this draws whatever it declared: a field added there appears here with no
/// code. What each subclass decides is only how its value is held while it is edited and how it is
/// sent, and every rule for that lives in <see cref="FormValues"/> and <see cref="FormRows"/>.
/// </remarks>
public abstract partial class FormFieldViewModel(FormField field) : ObservableObject
{
    public FormField Field { get; } = field;

    public string Key => Field.Key;

    public string Label => Field.Required ? $"{Field.Label} *" : Field.Label;

    public string? Help => Field.Help;

    public bool HasHelp => !string.IsNullOrWhiteSpace(Field.Help);

    /// <summary>Hidden while the field it depends on is unanswered, and then neither drawn nor sent.</summary>
    [ObservableProperty]
    private bool _isVisible = true;

    /// <summary>Raised whenever the value moves, so the form can re-ask which fields depend on it.</summary>
    public event Action? Edited;

    /// <summary>Whether the field has an answer, for <c>required</c> and for <c>dependsOn</c>.</summary>
    public abstract bool IsAnswered { get; }

    /// <summary>Whether there is something worth sending.</summary>
    public abstract bool IsDirty { get; }

    /// <summary>The value as sent, or null to leave out of the save entirely.</summary>
    public abstract JsonElement? Submission(FormEncoding encoding);

    /// <summary>The choices a live source offered, replacing what was declared where there are any.</summary>
    public virtual void Offer(IReadOnlyList<ConfigFieldOption> options)
    {
    }

    protected void Touch() => Edited?.Invoke();
}

/// <summary>A line or a block of text, a URL, or a set of comma-separated entries.</summary>
public sealed partial class TextFormFieldViewModel : FormFieldViewModel
{
    private readonly string _original;

    public TextFormFieldViewModel(FormField field, string? stored, string? derived)
        : base(field)
    {
        ArgumentNullException.ThrowIfNull(field);

        _original = stored ?? FormValues.Read(field.Default) ?? string.Empty;
        _text = _original;
        Derived = derived;
        Suggestions = [.. field.Options.Select(option => option.Value)];
    }

    public bool IsMultiline => Field.Type == ConfigFieldType.Text;

    /// <summary>What the station would use with the box left empty, where it worked one out.</summary>
    public string? Derived { get; }

    /// <summary>
    /// The placeholder: what the station would actually use, before an example of what to type.
    /// </summary>
    public string? Placeholder => Derived ?? Field.Placeholder;

    public string? DerivedNote => Derived is null ? null : $"Empty uses {Derived}.";

    /// <summary>What to offer while typing. Suggestions, never a whitelist: a value the source could not list stays typeable.</summary>
    public ObservableCollection<string> Suggestions { get; }

    public bool HasSuggestions => Suggestions.Count > 0 && !IsMultiline;

    public bool IsPlain => !HasSuggestions;

    [ObservableProperty]
    private string _text;

    partial void OnTextChanged(string value) => Touch();

    public override bool IsAnswered => Text.Trim().Length > 0;

    public override bool IsDirty => !string.Equals(Normalised(Text), Normalised(_original), StringComparison.Ordinal);

    public override JsonElement? Submission(FormEncoding encoding) =>
        IsDirty ? FormValues.Encode(Normalised(Text), Field.Type, encoding) : null;

    public override void Offer(IReadOnlyList<ConfigFieldOption> options)
    {
        ArgumentNullException.ThrowIfNull(options);

        // What is INSERTED has to be what the field takes, so the values are offered rather than
        // the labels: a speech engine listing `Connor.wav` as "Connor" would otherwise have its
        // display name stored in a field it answers 404 for.
        Suggestions.Clear();
        foreach (var option in options.Count > 0 ? options : Field.Options)
        {
            Suggestions.Add(option.Value);
        }

        OnPropertyChanged(nameof(HasSuggestions));
        OnPropertyChanged(nameof(IsPlain));
    }

    /// <summary>A tags field is compared and sent as the tidy line it is stored as.</summary>
    private string Normalised(string text) => Field.IsTags ? FormValues.Tag(FormValues.Tags(text)) : text;
}

/// <summary>A number, a size in gigabytes, or a slider between declared ends.</summary>
public sealed partial class NumberFormFieldViewModel : FormFieldViewModel
{
    private readonly string? _stored;
    private readonly string _original;

    public NumberFormFieldViewModel(FormField field, string? stored)
        : base(field)
    {
        ArgumentNullException.ThrowIfNull(field);

        _stored = stored;
        var raw = stored ?? FormValues.Read(field.Default) ?? string.Empty;
        _original = IsBytes ? FormValues.Gigabytes(raw) : raw;
        _text = _original;
        _value = double.TryParse(raw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var at)
            ? at
            : field.Min ?? 0;
    }

    /// <summary>A byte count shown in gigabytes, because nobody types a disk quota in bytes.</summary>
    public bool IsBytes => Field.Unit == ConfigFieldUnit.Bytes;

    public bool IsSlider => Field.IsSlider && !IsBytes;

    public bool IsBox => !IsSlider;

    public string? Suffix => IsBytes ? "GB" : null;

    public string? Placeholder => IsBytes ? Field.Placeholder ?? "No limit" : Field.Placeholder;

    public double Minimum => Field.Min ?? 0;

    public double Maximum => Field.Max ?? 100;

    public double Step => Field.Step ?? 1;

    /// <summary>A fraction reads as a percentage beside a slider; anything else as itself.</summary>
    public string Reading => Field.Unit == ConfigFieldUnit.Fraction
        ? $"{Math.Round(Value * 100)}%"
        : Value.ToString(System.Globalization.CultureInfo.InvariantCulture);

    [ObservableProperty]
    private string _text;

    [ObservableProperty]
    private double _value;

    partial void OnTextChanged(string value) => Touch();

    partial void OnValueChanged(double value)
    {
        // The slider is in the view whether or not it is drawn, and a hidden one still coerces its
        // value into its own default range: a linger of 300000 came back as 100. Only a field that
        // IS a slider takes its value from one.
        if (!IsSlider)
        {
            return;
        }

        // The slider is the same setting as the box; it writes the box's text so there is one value.
        var snapped = Math.Round(value / Step) * Step;
        Text = snapped.ToString(System.Globalization.CultureInfo.InvariantCulture);
        OnPropertyChanged(nameof(Reading));
    }

    public override bool IsAnswered => Text.Trim().Length > 0;

    /// <summary>Whether what is typed is a number at all, which the station would refuse otherwise.</summary>
    public bool IsValid => Text.Trim().Length == 0 || FormValues.IsNumber(Text.Trim());

    public override bool IsDirty => !string.Equals(Text.Trim(), _original, StringComparison.Ordinal);

    public override JsonElement? Submission(FormEncoding encoding)
    {
        if (!IsDirty)
        {
            return null;
        }

        var text = Text.Trim();

        // A blanked number that had a value is cleared; one that never had one has nothing to clear.
        if (text.Length == 0)
        {
            return _stored is null ? null : FormValues.Clear;
        }

        return FormValues.Encode(IsBytes ? FormValues.Bytes(text) : text, ConfigFieldType.Number, encoding);
    }
}

/// <summary>A switch.</summary>
public sealed partial class BooleanFormFieldViewModel : FormFieldViewModel
{
    private readonly bool _original;

    public BooleanFormFieldViewModel(FormField field, string? stored)
        : base(field)
    {
        ArgumentNullException.ThrowIfNull(field);

        _original = FormValues.IsOn(stored, field.Default);
        _switch = _original;
    }

    [ObservableProperty]
    private bool _switch;

    partial void OnSwitchChanged(bool value) => Touch();

    public override bool IsAnswered => Switch;

    public override bool IsDirty => Switch != _original;

    public override JsonElement? Submission(FormEncoding encoding) =>
        IsDirty ? FormValues.Encode(Switch ? "true" : "false", ConfigFieldType.Boolean, encoding) : null;
}

/// <summary>
/// A write-only field. Nothing about a stored secret is shown, because nothing about it is ever sent.
/// </summary>
public sealed partial class SecretFormFieldViewModel : FormFieldViewModel
{
    public SecretFormFieldViewModel(FormField field, bool stored)
        : base(field) => Stored = stored;

    /// <summary>Whether the station holds a value. Never the value.</summary>
    public bool Stored { get; }

    [ObservableProperty]
    private string _text = string.Empty;

    /// <summary>Asked to remove what is stored, which is a deliberate act and says so.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(State), nameof(ClearLabel), nameof(CanType))]
    private bool _cleared;

    public bool CanType => !Cleared;

    public string State => (Stored, Cleared) switch
    {
        (true, true) => "Will be removed when you save.",
        (true, false) => "Set. Type a new one to replace it.",
        _ => "Not set.",
    };

    public string ClearLabel => Cleared ? "Keep it" : "Remove";

    public string Placeholder => Stored && !Cleared ? "••••••••" : Field.Placeholder ?? string.Empty;

    partial void OnTextChanged(string value) => Touch();

    partial void OnClearedChanged(bool value)
    {
        if (value)
        {
            Text = string.Empty;
        }

        OnPropertyChanged(nameof(Placeholder));
        Touch();
    }

    [RelayCommand]
    private void ToggleCleared() => Cleared = !Cleared;

    public override bool IsAnswered => Stored && !Cleared || Text.Length > 0;

    /// <summary>A blank box means leave it alone: an empty string would clear it.</summary>
    public override bool IsDirty => Cleared || Text.Length > 0;

    public override JsonElement? Submission(FormEncoding encoding) =>
        Cleared ? FormValues.Clear
        : Text.Length > 0 ? FormValues.Encode(Text, ConfigFieldType.Secret, encoding)
        : null;
}

/// <summary>One of a closed set.</summary>
public sealed partial class SelectFormFieldViewModel : FormFieldViewModel
{
    private readonly string _original;

    public SelectFormFieldViewModel(FormField field, string? stored)
        : base(field)
    {
        ArgumentNullException.ThrowIfNull(field);

        _original = stored ?? FormValues.Read(field.Default) ?? string.Empty;
        Fill(field.Options);
        _chosen = Options.FirstOrDefault(option => option.Value == _original);
    }

    public ObservableCollection<ConfigFieldOption> Options { get; } = [];

    [ObservableProperty]
    private ConfigFieldOption? _chosen;

    partial void OnChosenChanged(ConfigFieldOption? value) => Touch();

    public override bool IsAnswered => Chosen is not null && Chosen.Value.Length > 0;

    public override bool IsDirty => !string.Equals(Chosen?.Value ?? _original, _original, StringComparison.Ordinal);

    public override JsonElement? Submission(FormEncoding encoding) =>
        IsDirty && Chosen is not null ? FormValues.Encode(Chosen.Value, ConfigFieldType.Select, encoding) : null;

    public override void Offer(IReadOnlyList<ConfigFieldOption> options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var keep = Chosen?.Value ?? _original;
        Fill(options.Count > 0 ? options : Field.Options);
        Chosen = Options.FirstOrDefault(option => option.Value == keep);
    }

    /// <summary>
    /// The choices, plus whatever is stored if it is not among them: a value a source can no longer
    /// list is still the value in force, and a box showing nothing would hide it.
    /// </summary>
    private void Fill(IEnumerable<ConfigFieldOption> options)
    {
        Options.Clear();
        foreach (var option in options)
        {
            Options.Add(option);
        }

        if (_original.Length > 0 && Options.All(option => option.Value != _original))
        {
            Options.Add(new ConfigFieldOption { Value = _original, Label = _original });
        }
    }
}

/// <summary>One choice of a multiselect.</summary>
public sealed partial class FormChoiceViewModel(ConfigFieldOption option, bool chosen, Action changed) : ObservableObject
{
    public ConfigFieldOption Option { get; } = option;

    public string Label => Option.Label;

    [ObservableProperty]
    private bool _isChosen = chosen;

    partial void OnIsChosenChanged(bool value) => changed();
}

/// <summary>Any number of a set, stored as the JSON array of their values.</summary>
public sealed class MultiSelectFormFieldViewModel : FormFieldViewModel
{
    private readonly IReadOnlyList<string> _original;

    public MultiSelectFormFieldViewModel(FormField field, string? stored)
        : base(field)
    {
        ArgumentNullException.ThrowIfNull(field);

        _original = FormValues.Chosen(stored ?? FormValues.Read(field.Default));
        Fill(field.Options, _original);
    }

    public ObservableCollection<FormChoiceViewModel> Choices { get; } = [];

    private IEnumerable<string> Chosen => Choices.Where(choice => choice.IsChosen).Select(choice => choice.Option.Value);

    public override bool IsAnswered => Chosen.Any();

    public override bool IsDirty => !Chosen.SequenceEqual(_original, StringComparer.Ordinal);

    public override JsonElement? Submission(FormEncoding encoding) =>
        IsDirty ? FormValues.Encode(FormValues.Choose(Chosen), ConfigFieldType.Multiselect, encoding) : null;

    public override void Offer(IReadOnlyList<ConfigFieldOption> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        Fill(options.Count > 0 ? options : Field.Options, [.. Chosen]);
    }

    private void Fill(IEnumerable<ConfigFieldOption> options, IReadOnlyList<string> chosen)
    {
        Choices.Clear();
        foreach (var option in options)
        {
            Choices.Add(new FormChoiceViewModel(option, chosen.Contains(option.Value), Touch));
        }

        // Kept even when no source lists it any more, for the select's reason.
        foreach (var value in chosen.Where(value => Choices.All(choice => choice.Option.Value != value)))
        {
            Choices.Add(new FormChoiceViewModel(new ConfigFieldOption { Value = value, Label = value }, true, Touch));
        }
    }
}

/// <summary>
/// Help text with no value of its own, and what the station worked out for it where it did.
/// </summary>
public sealed class NoteFormFieldViewModel(FormField field, string? derived) : FormFieldViewModel(field)
{
    public string? Derived { get; } = derived;

    public bool HasDerived => Derived is not null;

    public override bool IsAnswered => false;

    public override bool IsDirty => false;

    public override JsonElement? Submission(FormEncoding encoding) => null;
}
