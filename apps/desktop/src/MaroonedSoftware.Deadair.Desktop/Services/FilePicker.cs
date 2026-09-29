using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Platform.Storage;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>A file somebody chose to send to the station.</summary>
/// <param name="Name">Its name, as the station is told it.</param>
/// <param name="Data">Its bytes, read whole: everything the station takes is a clip, a pack or a document.</param>
public sealed record PickedFile(string Name, byte[] Data);

/// <summary>
/// The system's open and save panels, for a view model that cannot reach a window.
/// </summary>
/// <remarks>
/// A seam so that a view model asks for "a file" rather than for Avalonia's storage provider, which
/// needs a <see cref="TopLevel"/> a view model has no business holding. Answers null when somebody
/// cancels, which is an answer rather than a failure.
/// </remarks>
public interface IFilePicker
{
    /// <param name="title">What the panel asks.</param>
    /// <param name="patterns">Which files it offers, as <c>*.mp3</c>-style patterns. Empty offers any.</param>
    Task<PickedFile?> OpenAsync(string title, IReadOnlyList<string> patterns);

    /// <summary>Writes bytes where somebody chooses, answering whether they chose somewhere.</summary>
    Task<bool> SaveAsync(string title, string suggestedName, byte[] data);
}

/// <summary>The panels of the app's main window.</summary>
public sealed class FilePicker : IFilePicker
{
    public async Task<PickedFile?> OpenAsync(string title, IReadOnlyList<string> patterns)
    {
        ArgumentNullException.ThrowIfNull(patterns);

        if (Storage() is not { } storage)
        {
            return null;
        }

        var chosen = await storage.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = title,
            AllowMultiple = false,
            FileTypeFilter = patterns.Count == 0 ? null : [new FilePickerFileType(title) { Patterns = [.. patterns] }],
        }).ConfigureAwait(true);

        if (chosen.Count == 0)
        {
            return null;
        }

        var file = chosen[0];
        await using var stream = await file.OpenReadAsync().ConfigureAwait(true);
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer).ConfigureAwait(true);
        return new PickedFile(file.Name, buffer.ToArray());
    }

    public async Task<bool> SaveAsync(string title, string suggestedName, byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);

        if (Storage() is not { } storage)
        {
            return false;
        }

        var file = await storage.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = title,
            SuggestedFileName = suggestedName,
            ShowOverwritePrompt = true,
        }).ConfigureAwait(true);

        if (file is null)
        {
            return false;
        }

        await using var stream = await file.OpenWriteAsync().ConfigureAwait(true);
        await stream.WriteAsync(data).ConfigureAwait(true);
        return true;
    }

    private static IStorageProvider? Storage() =>
        (Application.Current?.ApplicationLifetime as IClassicDesktopStyleApplicationLifetime)?.MainWindow?.StorageProvider;
}
