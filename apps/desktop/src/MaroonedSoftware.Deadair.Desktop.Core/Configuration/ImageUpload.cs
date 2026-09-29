namespace MaroonedSoftware.Deadair.Desktop.Core.Configuration;

/// <summary>What the station takes as break artwork, checked before the bytes go anywhere.</summary>
/// <remarks>
/// The station decides by the BYTES, so this only spares an obvious mistake a round trip, as the
/// console's dropzone does. The limit is the station's <c>MAX_BREAK_ART_BYTES</c>.
/// </remarks>
public static class ImageUpload
{
    public const long MaxBytes = 4 * 1024 * 1024;

    /// <summary>The patterns the open panel offers.</summary>
    public static IReadOnlyList<string> Patterns { get; } = ["*.jpg", "*.jpeg", "*.png", "*.webp", "*.gif"];

    /// <summary>The content type to send a picture as, from its name, or null for one the station will not take.</summary>
    public static string? ContentType(string fileName)
    {
        ArgumentNullException.ThrowIfNull(fileName);

        return Path.GetExtension(fileName).ToUpperInvariant() switch
        {
            ".JPG" or ".JPEG" => "image/jpeg",
            ".PNG" => "image/png",
            ".WEBP" => "image/webp",
            ".GIF" => "image/gif",
            _ => null,
        };
    }

    /// <summary>Why a picture cannot go up, in words, or null when it can.</summary>
    public static string? Problem(string fileName, long length) =>
        ContentType(fileName) is null ? $"{fileName} is not a jpeg, png, webp or gif picture."
        : length > MaxBytes ? $"{fileName} is larger than 4 MB, which is the most the station takes."
        : null;
}
