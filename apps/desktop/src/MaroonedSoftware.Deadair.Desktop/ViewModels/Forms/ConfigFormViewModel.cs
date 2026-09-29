using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>
/// A form drawn from what the station or a plugin declared, with no knowledge of what it configures.
/// </summary>
/// <remarks>
/// <para>
/// Shared by the station's settings, a plugin's configuration and every settings subset a page shows
/// (sustaining, phrasings, sign-in), because they are one problem: the same descriptors, the same
/// partial-update contract, the same write-only secrets. Two renderers would drift, and the way they
/// would drift is a secret being displayed on one of them.
/// </para>
/// <para>
/// Only what CHANGED is sent. The endpoints take a partial write, and sending every value back would
/// overwrite one somebody else edited while this was open. The station stays the authority on what
/// is valid; the checks here only spare a round trip.
/// </para>
/// </remarks>
public sealed partial class ConfigFormViewModel : ObservableObject
{
    public ConfigFormViewModel(
        IEnumerable<FormField> fields,
        IReadOnlyDictionary<string, JsonElement> stored,
        IReadOnlyDictionary<string, bool> configured,
        FormEncoding encoding,
        IReadOnlyDictionary<string, string>? derived = null)
    {
        ArgumentNullException.ThrowIfNull(fields);
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(configured);

        Encoding = encoding;
        foreach (var field in fields)
        {
            var value = stored.TryGetValue(field.Key, out var element) ? FormValues.Read(element) : null;
            var worked = derived is not null && derived.TryGetValue(field.Key, out var said) ? said : null;
            var built = Build(field, value, configured, worked);
            built.Edited += Reconsider;
            Fields.Add(built);
        }

        Reconsider();
    }

    public FormEncoding Encoding { get; }

    public ObservableCollection<FormFieldViewModel> Fields { get; } = [];

    /// <summary>Whether anything has been edited that nobody has saved.</summary>
    [ObservableProperty]
    private bool _isDirty;

    /// <summary>
    /// What would be sent: the fields that are shown and have changed, and nothing else.
    /// </summary>
    /// <remarks>
    /// A field hidden by <c>dependsOn</c> is not part of the form yet, so it is not sent either,
    /// whatever it holds.
    /// </remarks>
    public Dictionary<string, JsonElement> Submission()
    {
        var submission = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var field in Fields.Where(field => field.IsVisible))
        {
            if (field.Submission(Encoding) is { } value)
            {
                submission[field.Key] = value;
            }
        }

        return submission;
    }

    /// <summary>The first thing that stops this being sent, in words, or null.</summary>
    public string? Problem()
    {
        foreach (var field in Fields.Where(field => field.IsVisible))
        {
            if (field.Field.Required && !field.IsAnswered)
            {
                return $"{field.Field.Label} needs an answer.";
            }

            if (field is NumberFormFieldViewModel { IsValid: false })
            {
                return $"{field.Field.Label} has to be a number.";
            }
        }

        return null;
    }

    /// <summary>The live sources this form's fields and columns ask for, to be resolved and offered back.</summary>
    public IReadOnlySet<ConfigFieldOptionSource> Sources() =>
        Fields.SelectMany(field => field.Field.Columns.Select(column => column.OptionsFrom).Prepend(field.Field.OptionsFrom))
            .OfType<ConfigFieldOptionSource>()
            .ToHashSet();

    /// <summary>Hands each field or column the choices resolved for the source it named.</summary>
    public void Offer(IReadOnlyDictionary<ConfigFieldOptionSource, IReadOnlyList<ConfigFieldOption>> resolved)
    {
        ArgumentNullException.ThrowIfNull(resolved);

        foreach (var field in Fields)
        {
            if (field.Field.OptionsFrom is { } source && resolved.TryGetValue(source, out var options))
            {
                field.Offer(options);
            }

            if (field is ListFormFieldViewModel list)
            {
                foreach (var column in field.Field.Columns)
                {
                    if (column.OptionsFrom is { } from && resolved.TryGetValue(from, out var offered))
                    {
                        list.OfferColumn(column.Key, offered);
                    }
                }
            }
        }
    }

    /// <summary>
    /// Suggestions a plugin gave for its own fields, keyed by field (or <c>field.column</c>), which
    /// outrank anything declared.
    /// </summary>
    public void Suggest(IReadOnlyDictionary<string, List<ConfigFieldOption>> suggestions)
    {
        ArgumentNullException.ThrowIfNull(suggestions);

        foreach (var field in Fields)
        {
            if (suggestions.TryGetValue(field.Key, out var options) && options.Count > 0)
            {
                field.Offer(options);
            }

            if (field is ListFormFieldViewModel list)
            {
                foreach (var column in field.Field.Columns)
                {
                    if (suggestions.TryGetValue($"{field.Key}.{column.Key}", out var offered) && offered.Count > 0)
                    {
                        list.OfferColumn(column.Key, offered);
                    }
                }
            }
        }
    }

    /// <summary>Re-asks which fields are shown, and whether anything is unsaved, after any edit.</summary>
    /// <remarks>
    /// A target that is not in this form at all (a page showing one group of a larger set) counts as
    /// answered: hiding a field because its condition lives on another page would be worse than
    /// showing it.
    /// </remarks>
    private void Reconsider()
    {
        foreach (var field in Fields)
        {
            field.IsVisible = field.Field.DependsOn is not { } target
                || Fields.FirstOrDefault(candidate => candidate.Key == target) is not { } depends
                || depends.IsAnswered;
        }

        IsDirty = Fields.Any(field => field.IsVisible && field.IsDirty);
    }

    private static FormFieldViewModel Build(
        FormField field,
        string? value,
        IReadOnlyDictionary<string, bool> configured,
        string? derived) => field.Type switch
        {
            ConfigFieldType.Secret => new SecretFormFieldViewModel(
                field,
                configured.TryGetValue(field.Key, out var set) && set),
            ConfigFieldType.Boolean => new BooleanFormFieldViewModel(field, value),
            ConfigFieldType.Number => new NumberFormFieldViewModel(field, value),
            ConfigFieldType.Select => new SelectFormFieldViewModel(field, value),
            ConfigFieldType.Multiselect => new MultiSelectFormFieldViewModel(field, value),
            ConfigFieldType.List => new ListFormFieldViewModel(field, value, configured),
            ConfigFieldType.Note => new NoteFormFieldViewModel(field, derived),
            _ => new TextFormFieldViewModel(field, value, derived),
        };
}
