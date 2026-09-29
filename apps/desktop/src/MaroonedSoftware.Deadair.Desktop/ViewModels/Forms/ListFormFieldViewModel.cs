using System.Collections.ObjectModel;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MaroonedSoftware.Deadair.Desktop.Core.Forms;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.ViewModels;

/// <summary>One cell of one row of a list.</summary>
public sealed partial class FormCellViewModel : ObservableObject
{
    private readonly Action _changed;

    public FormCellViewModel(ConfigFieldColumn column, string text, bool secretStored, Action changed)
    {
        ArgumentNullException.ThrowIfNull(column);

        Column = column;
        _text = text;
        SecretStored = secretStored;
        _changed = changed;
        Options = [.. column.Options ?? []];
    }

    public ConfigFieldColumn Column { get; }

    public string Label => Column.Required == true ? $"{Column.Label} *" : Column.Label;

    public bool IsSecret => Column.Type == ConfigFieldColumnType.Secret;

    public bool IsSelect => Column.Type == ConfigFieldColumnType.Select && Options.Count > 0;

    public bool IsText => !IsSecret && !IsSelect;

    public ObservableCollection<ConfigFieldOption> Options { get; }

    /// <summary>Whether the station holds a credential for this cell. Never the credential.</summary>
    public bool SecretStored { get; }

    public string? Placeholder => IsSecret && SecretStored && !Cleared ? "••••••••" : Column.Placeholder;

    [ObservableProperty]
    private string _text;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(Placeholder), nameof(ClearLabel))]
    private bool _cleared;

    public string ClearLabel => Cleared ? "Keep" : "Remove";

    /// <summary>Whether this cell means anything for its row, which a column can make depend on another cell.</summary>
    [ObservableProperty]
    private bool _applies = true;

    public ConfigFieldOption? Chosen
    {
        get => Options.FirstOrDefault(option => option.Value == Text);
        set => Text = value?.Value ?? string.Empty;
    }

    partial void OnTextChanged(string value)
    {
        OnPropertyChanged(nameof(Chosen));
        _changed();
    }

    partial void OnClearedChanged(bool value)
    {
        if (value)
        {
            Text = string.Empty;
        }

        _changed();
    }

    [RelayCommand]
    private void ToggleCleared() => Cleared = !Cleared;

    /// <summary>A live source's choices for this column, or its declared ones where it offered none.</summary>
    public void Offer(IReadOnlyList<ConfigFieldOption> options)
    {
        var keep = Text;
        Options.Clear();
        foreach (var option in options.Count > 0 ? options : Column.Options ?? [])
        {
            Options.Add(option);
        }

        OnPropertyChanged(nameof(IsSelect));
        OnPropertyChanged(nameof(IsText));
        Text = keep;
        OnPropertyChanged(nameof(Chosen));
    }
}

/// <summary>One row of a list.</summary>
public sealed class FormRowViewModel
{
    public FormRowViewModel(
        IReadOnlyList<ConfigFieldColumn> columns,
        IReadOnlyDictionary<string, string> row,
        string fieldKey,
        IReadOnlyDictionary<string, bool> configured,
        Action changed)
    {
        ArgumentNullException.ThrowIfNull(columns);
        ArgumentNullException.ThrowIfNull(row);
        ArgumentNullException.ThrowIfNull(configured);

        Columns = columns;
        RowId = row.TryGetValue(FormRows.RowIdKey, out var id) ? id : null;

        foreach (var column in columns)
        {
            var stored = RowId is not null
                && configured.TryGetValue(FormRows.SecretKey(fieldKey, RowId, column.Key), out var set)
                && set;

            Cells.Add(new FormCellViewModel(column, row.TryGetValue(column.Key, out var text) ? text : string.Empty, stored, () =>
            {
                Reapply();
                changed();
            }));
        }

        Reapply();
    }

    public IReadOnlyList<ConfigFieldColumn> Columns { get; }

    /// <summary>What a stored credential in this row hangs off. Carried through, never drawn.</summary>
    public string? RowId { get; }

    public ObservableCollection<FormCellViewModel> Cells { get; } = [];

    /// <summary>The row as its cells stand, for sending.</summary>
    public Dictionary<string, string> Values()
    {
        var values = Cells.ToDictionary(cell => cell.Column.Key, cell => cell.Text, StringComparer.Ordinal);
        if (RowId is not null)
        {
            values[FormRows.RowIdKey] = RowId;
        }

        return values;
    }

    /// <summary>The secret cells somebody asked to remove, keyed the way the station addresses them.</summary>
    public IEnumerable<string> Cleared(string fieldKey) =>
        RowId is null
            ? []
            : Cells.Where(cell => cell.IsSecret && cell.Cleared).Select(cell => FormRows.SecretKey(fieldKey, RowId, cell.Column.Key));

    private void Reapply()
    {
        var values = Values();
        foreach (var cell in Cells)
        {
            cell.Applies = FormRows.AppliesToRow(cell.Column, Columns, values);
        }
    }
}

/// <summary>
/// A table of rows, stored as the JSON array of them.
/// </summary>
/// <remarks>
/// Reordered by buttons rather than by dragging. Row order is often the order something is tried in,
/// and a mis-dropped row is a silent change to it.
/// </remarks>
public sealed partial class ListFormFieldViewModel : FormFieldViewModel
{
    private readonly string _original;
    private readonly IReadOnlyDictionary<string, bool> _configured;

    public ListFormFieldViewModel(FormField field, string? stored, IReadOnlyDictionary<string, bool> configured)
        : base(field)
    {
        ArgumentNullException.ThrowIfNull(field);

        _configured = configured;
        var rows = FormRows.Parse(stored ?? FormValues.Read(field.Default), field.Columns);
        foreach (var row in rows)
        {
            Rows.Add(Row(row));
        }

        // Compared as the submission it would make, so a row that only gained an id on the way in
        // (a list stored before rows had them) is not a change nobody made.
        _original = FormRows.Submit(rows, field.Columns, field.Key, new HashSet<string>());
        Presets = field.Presets;
    }

    public ObservableCollection<FormRowViewModel> Rows { get; } = [];

    public IReadOnlyList<ConfigFieldColumn> Columns => Field.Columns;

    public IReadOnlyList<ConfigFieldPreset> Presets { get; }

    public bool HasPresets => Presets.Count > 0;

    public override bool IsAnswered => Rows.Any(row => !FormRows.IsBlank(row.Values()));

    public override bool IsDirty => Current() != _original || Cleared().Count > 0;

    public override JsonElement? Submission(FormEncoding encoding) =>
        IsDirty ? FormValues.Encode(Current(), ConfigFieldType.List, encoding) : null;

    /// <summary>What a live source offered for one of this list's columns.</summary>
    public void OfferColumn(string columnKey, IReadOnlyList<ConfigFieldOption> options)
    {
        foreach (var cell in Rows.SelectMany(row => row.Cells).Where(cell => cell.Column.Key == columnKey))
        {
            cell.Offer(options);
        }
    }

    [RelayCommand]
    private void AddRow()
    {
        Rows.Add(Row(FormRows.Empty(Columns)));
        Touch();
    }

    [RelayCommand]
    private void AddPreset(ConfigFieldPreset preset)
    {
        Rows.Add(Row(FormRows.From(Columns, preset)));
        Touch();
    }

    [RelayCommand]
    private void RemoveRow(FormRowViewModel row)
    {
        Rows.Remove(row);
        Touch();
    }

    [RelayCommand]
    private void MoveUp(FormRowViewModel row)
    {
        var at = Rows.IndexOf(row);
        if (at > 0)
        {
            Rows.Move(at, at - 1);
            Touch();
        }
    }

    [RelayCommand]
    private void MoveDown(FormRowViewModel row)
    {
        var at = Rows.IndexOf(row);
        if (at >= 0 && at < Rows.Count - 1)
        {
            Rows.Move(at, at + 1);
            Touch();
        }
    }

    private FormRowViewModel Row(IReadOnlyDictionary<string, string> values) =>
        new(Columns, values, Field.Key, _configured, Touch);

    private HashSet<string> Cleared() => [.. Rows.SelectMany(row => row.Cleared(Field.Key))];

    private string Current() => FormRows.Submit(Rows.Select(row => row.Values()), Columns, Field.Key, Cleared());
}
