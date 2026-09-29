using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using MaroonedSoftware.Deadair.Sdk.Models;

namespace MaroonedSoftware.Deadair.Desktop.Core.Forms;

/// <summary>
/// The rows of a <c>list</c> field: stored as a JSON array of objects, drawn as a table.
/// </summary>
/// <remarks>
/// <para>
/// Every cell is a string, and the column decides the control rather than the value. A row is a
/// dictionary from column key to text, plus <see cref="RowIdKey"/> where the list holds a credential.
/// </para>
/// <para>
/// Each rule here is the web console's and the station's (`shared/config.rows.ts`), for the reasons
/// written there. The one that cost an incident: a row that can hold a credential gets its id HERE,
/// before its first save, because an id minted by the station never reached a form that is not rebuilt
/// after saving, and the next save deleted the key the operator had just typed.
/// </para>
/// </remarks>
public static class FormRows
{
    /// <summary>The cell a row's own identity lives under. Carried through, never drawn.</summary>
    public const string RowIdKey = "$id";

    /// <summary>How a credential inside a row is addressed in the station's configured map.</summary>
    public static string SecretKey(string fieldKey, string rowId, string columnKey) => $"{fieldKey}/{rowId}/{columnKey}";

    /// <summary>Only a list holding a credential numbers its rows; in any other an id addresses nothing.</summary>
    public static bool HoldsRowSecrets(IReadOnlyList<ConfigFieldColumn> columns) =>
        columns.Any(column => column.Type == ConfigFieldColumnType.Secret);

    /// <summary>Six random bytes as base64url, the station's own shape, which can never hold a <c>/</c>.</summary>
    public static string MintRowId() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(6))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

    /// <summary>
    /// The rows out of the stored JSON, keeping blank ones (a row just added is blank) and dropping
    /// any cell whose column is no longer declared.
    /// </summary>
    public static List<Dictionary<string, string>> Parse(string? value, IReadOnlyList<ConfigFieldColumn> columns)
    {
        ArgumentNullException.ThrowIfNull(columns);

        if (string.IsNullOrWhiteSpace(value))
        {
            return [];
        }

        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(value);
        }
        catch (JsonException)
        {
            return [];
        }

        if (parsed is not JsonArray array)
        {
            return [];
        }

        var rows = new List<Dictionary<string, string>>();
        foreach (var entry in array)
        {
            if (entry is not JsonObject stored)
            {
                continue;
            }

            var row = new Dictionary<string, string>(StringComparer.Ordinal);

            if (stored[RowIdKey] is JsonValue id && id.TryGetValue<string>(out var rowId) && rowId.Length > 0)
            {
                row[RowIdKey] = rowId;
            }
            else if (HoldsRowSecrets(columns))
            {
                row[RowIdKey] = MintRowId();
            }

            foreach (var column in columns)
            {
                row[column.Key] = stored[column.Key] is JsonValue cell && cell.TryGetValue<string>(out var text) ? text : string.Empty;
            }

            rows.Add(row);
        }

        return rows;
    }

    /// <summary>An empty row of the declared columns, born with its id if it can hold a credential.</summary>
    public static Dictionary<string, string> Empty(IReadOnlyList<ConfigFieldColumn> columns)
    {
        ArgumentNullException.ThrowIfNull(columns);

        var row = columns.ToDictionary(column => column.Key, _ => string.Empty, StringComparer.Ordinal);
        if (HoldsRowSecrets(columns))
        {
            row[RowIdKey] = MintRowId();
        }

        return row;
    }

    /// <summary>A new row with a preset's cells filled in. A preset never fills a secret.</summary>
    public static Dictionary<string, string> From(IReadOnlyList<ConfigFieldColumn> columns, ConfigFieldPreset preset)
    {
        ArgumentNullException.ThrowIfNull(preset);

        var row = Empty(columns);
        foreach (var column in columns)
        {
            if (column.Type != ConfigFieldColumnType.Secret && preset.Cells.TryGetValue(column.Key, out var value))
            {
                row[column.Key] = value;
            }
        }

        return row;
    }

    /// <summary>A row nobody filled in. The id does not count: it is bookkeeping, not an answer.</summary>
    public static bool IsBlank(IReadOnlyDictionary<string, string> row) =>
        row.All(cell => cell.Key == RowIdKey || cell.Value.Trim().Length == 0);

    /// <summary>
    /// Whether a column applies to this row. Forgiving three ways, as the station is: a target the list
    /// does not declare, and a target cell still empty, both show the cell.
    /// </summary>
    /// <remarks>
    /// Also consulted when sending, because a cell that does not apply is not sent: an address left
    /// behind by a change of kind would otherwise be stored and read into the plugin's allowlist.
    /// </remarks>
    public static bool AppliesToRow(ConfigFieldColumn column, IReadOnlyList<ConfigFieldColumn> columns, IReadOnlyDictionary<string, string> row)
    {
        ArgumentNullException.ThrowIfNull(column);

        if (column.DependsOn is null || !columns.Any(candidate => candidate.Key == column.DependsOn))
        {
            return true;
        }

        var value = row.TryGetValue(column.DependsOn, out var cell) ? cell.Trim() : string.Empty;
        if (value.Length == 0)
        {
            return true;
        }

        return column.DependsOnValues is null || column.DependsOnValues.Contains(value);
    }

    /// <summary>
    /// The rows as they are sent: blank rows dropped, cells trimmed, empty cells left out, and each
    /// row's id carried so a stored credential stays attached to it.
    /// </summary>
    /// <remarks>
    /// A secret cell is three-way, as a secret field is: typed sets it, absent keeps what is stored
    /// (so a row can be renamed without retyping its key), and null clears it — only when somebody
    /// asked for exactly that.
    /// </remarks>
    public static string Submit(
        IEnumerable<IReadOnlyDictionary<string, string>> rows,
        IReadOnlyList<ConfigFieldColumn> columns,
        string fieldKey,
        IReadOnlySet<string> cleared)
    {
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(cleared);

        var array = new JsonArray();
        foreach (var row in rows.Where(row => !IsBlank(row)))
        {
            var submitted = new JsonObject();
            row.TryGetValue(RowIdKey, out var rowId);
            if (rowId is not null)
            {
                submitted[RowIdKey] = rowId;
            }

            foreach (var column in columns)
            {
                if (!AppliesToRow(column, columns, row))
                {
                    continue;
                }

                var cell = row.TryGetValue(column.Key, out var text) ? text.Trim() : string.Empty;

                if (column.Type == ConfigFieldColumnType.Secret)
                {
                    if (rowId is not null && cleared.Contains(SecretKey(fieldKey, rowId, column.Key)))
                    {
                        submitted[column.Key] = null;
                    }
                    else if (cell.Length > 0)
                    {
                        submitted[column.Key] = cell;
                    }

                    continue;
                }

                if (cell.Length > 0)
                {
                    submitted[column.Key] = cell;
                }
            }

            array.Add(submitted);
        }

        return array.ToJsonString();
    }
}
