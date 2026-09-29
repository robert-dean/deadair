using MaroonedSoftware.Deadair.Desktop.Core.Playback;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// Turns what an audio endpoint answered into a clip.
/// </summary>
/// <remarks>
/// Every audio endpoint answers with the same family of records, one per content type
/// (<c>Status200AudioWav</c>, <c>AudioMpeg</c>…), each holding <c>Data</c>. The generated SDK makes
/// one family per endpoint, so they share a shape rather than a type; this reads the shape once
/// instead of writing the same switch for every endpoint. A 304 has no bytes and is no clip.
/// </remarks>
public static class Clips
{
    public static Clip? From(object? response)
    {
        if (response?.GetType().GetProperty("Data")?.GetValue(response) is not byte[] data)
        {
            return null;
        }

        var name = response.GetType().Name;
        var extension =
            name.EndsWith("Wav", StringComparison.Ordinal) ? ".wav"
            : name.EndsWith("Ogg", StringComparison.Ordinal) ? ".ogg"
            : name.EndsWith("Flac", StringComparison.Ordinal) ? ".flac"
            : name.EndsWith("Mp4", StringComparison.Ordinal) ? ".m4a"
            : ".mp3";

        return new Clip(data, extension);
    }
}
