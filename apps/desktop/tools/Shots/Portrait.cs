using System.Net;
using System.Net.Http.Headers;
using Avalonia;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using MaroonedSoftware.Deadair.Desktop.Services;
using MaroonedSoftware.Deadair.Desktop.ViewModels;

namespace Shots;

/// <summary>
/// A presenter's portrait, drawn here rather than shipped, and served to the app's own loader.
/// </summary>
/// <remarks>
/// The portrait beside the host line is drawn by the <c>Artwork</c> control, which fetches through
/// <see cref="ArtworkLoader.Shared"/> like every cover in a list. So a frame that wants one installs a
/// loader whose client answers the portrait's address with a picture and every other address with a
/// 404, which leaves every other frame's covers exactly as they were: initials.
/// </remarks>
internal static class Portrait
{
    /// <summary>Where the posed station keeps Cass's picture, already resolved under the API root.</summary>
    public static readonly Uri Url = new("https://radio.example.com/api/art/persona/cass");

    private static readonly Lazy<byte[]> Png = new(Draw);

    /// <summary>The portrait as the hero's bitmap, which a break takes as its cover.</summary>
    public static Bitmap Bitmap()
    {
        using var stream = new MemoryStream(Png.Value);
        return new Bitmap(stream);
    }

    /// <summary>The colours the sampler would take from it, so a break's wash is in frame.</summary>
    public static IReadOnlyList<uint> Palette { get; } = [0xFF2E4A3F, 0xFFD9A066, 0xFF14201B];

    /// <summary>A loader that has this one picture and nothing else.</summary>
    public static ArtworkLoader Loader() => new(new HttpClient(new Serves()));

    /// <summary>A record with the presenter's picture beside "with Cass".</summary>
    public static void BesideTheLine(ListenerViewModel listener)
    {
        listener.HostPortrait = Url;
        listener.HostInitial = "C";
    }

    /// <summary>A break whose cover is the presenter, and so nothing beside the line.</summary>
    public static void AsTheCover(ListenerViewModel listener)
    {
        Fakes.OnTheMic(listener);
        listener.HostPortrait = null;
        listener.HostInitial = "C";
        listener.Artwork = Bitmap();
        listener.CoverPalette = Palette;
    }

    /// <summary>A head and shoulders on a green field: plainly a person, and plainly not a record sleeve.</summary>
    private static byte[] Draw()
    {
        const int side = 512;
        using var target = new RenderTargetBitmap(new PixelSize(side, side), new Vector(96, 96));

        using (var context = target.CreateDrawingContext())
        {
            var field = new LinearGradientBrush
            {
                StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
                EndPoint = new RelativePoint(1, 1, RelativeUnit.Relative),
                GradientStops = { new GradientStop(Color.FromRgb(0x3C, 0x6E, 0x5A), 0), new GradientStop(Color.FromRgb(0x14, 0x20, 0x1B), 1) },
            };
            context.FillRectangle(field, new Rect(0, 0, side, side));

            var skin = new SolidColorBrush(Color.FromRgb(0xD9, 0xA0, 0x66));
            var coat = new SolidColorBrush(Color.FromRgb(0x2A, 0x2A, 0x30));
            var hair = new SolidColorBrush(Color.FromRgb(0x3A, 0x22, 0x18));

            context.DrawEllipse(coat, null, new Point(side / 2.0, side * 1.02), side * 0.42, side * 0.34);
            context.DrawEllipse(hair, null, new Point(side / 2.0, side * 0.36), side * 0.19, side * 0.2);
            context.DrawEllipse(skin, null, new Point(side / 2.0, side * 0.42), side * 0.16, side * 0.19);
        }

        using var stream = new MemoryStream();
        target.Save(stream, new PngBitmapEncoderOptions());
        return stream.ToArray();
    }

    private sealed class Serves : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.RequestUri != Url)
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            }

            var content = new ByteArrayContent(Png.Value);
            content.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = content });
        }
    }
}
