using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Media.Imaging;
using Avalonia.Platform;

namespace MaroonedSoftware.Deadair.Desktop.Services;

/// <summary>
/// A cover's pixels as ARGB values, for <see cref="Core.NowPlaying.CoverColours"/> to read.
/// </summary>
/// <remarks>
/// The rules are in Core, where they are unit tests; this is only the part that needs Avalonia, which
/// is getting the numbers out of a bitmap. It is handed a bitmap decoded at a few pixels wide, so the
/// copy is a few hundred values and the sampling is the decoder's own averaging.
/// </remarks>
internal static class CoverSampler
{
    /// <summary>How wide a cover is decoded for sampling. Sixteen squared is enough to find its colours in.</summary>
    public const int SampleWidth = 16;

    public static uint[] Pixels(Bitmap bitmap)
    {
        var size = bitmap.PixelSize;
        var stride = size.Width * 4;
        var bytes = new byte[stride * size.Height];
        var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try
        {
            bitmap.CopyPixels(new PixelRect(size), handle.AddrOfPinnedObject(), bytes.Length, stride);
        }
        finally
        {
            handle.Free();
        }

        // Skia's own order on this platform is BGRA; RGBA is read too, so a decoder that answers in
        // it gives the cover's colours rather than its colours with red and blue swapped.
        var rgba = bitmap.Format == PixelFormats.Rgba8888;
        var pixels = new uint[size.Width * size.Height];
        for (var i = 0; i < pixels.Length; i++)
        {
            var at = i * 4;
            var (r, g, b) = rgba ? (bytes[at], bytes[at + 1], bytes[at + 2]) : (bytes[at + 2], bytes[at + 1], bytes[at]);
            pixels[i] = (uint)bytes[at + 3] << 24 | (uint)r << 16 | (uint)g << 8 | b;
        }

        return pixels;
    }
}
