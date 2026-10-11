using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Rendering.SceneGraph;
using Avalonia.Skia;
using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using SkiaSharp;

namespace MaroonedSoftware.Deadair.Desktop.Controls;

/// <summary>
/// Studio's backdrop drawn from the cover itself: a small, heavily blurred copy breathing slowly, two
/// feathered discs of it turning opposite ways, darkened until white type reads, with dither against
/// banding. A prototype behind <c>DesktopSettings.StudioBackdrop</c>.
/// </summary>
/// <remarks>
/// <para>
/// Everything about the clock is <see cref="StudioBackdrop"/>'s contract, kept exactly: twenty frames a
/// second, a clock that runs only while this control's OWN <c>IsVisible</c> is true, none at all for
/// Reduce Motion, nothing drawn while the window cannot be seen (through the same
/// <see cref="StudioBackdrop.Facts"/>), <see cref="StudioDrift"/>'s speeds eased between playing and
/// stopped, and a new cover faded in over two seconds. The numbers are
/// <see cref="StudioCoverMotion"/>'s, in Core with tests.
/// </para>
/// <para>
/// The cover is shrunk to <see cref="TextureSide"/> pixels and blurred ONCE, when it arrives, on the CPU;
/// a frame only samples that texture, through an <see cref="SKRuntimeEffect"/> on the leased Skia canvas.
/// Where there is no Skia to lease, it draws the gradients instead, from <see cref="Palette"/>.
/// </para>
/// </remarks>
public sealed class StudioCoverBackdrop : Control
{
    public static readonly StyledProperty<Bitmap?> CoverProperty =
        AvaloniaProperty.Register<StudioCoverBackdrop, Bitmap?>(nameof(Cover));

    public static readonly StyledProperty<IReadOnlyList<uint>?> PaletteProperty =
        AvaloniaProperty.Register<StudioCoverBackdrop, IReadOnlyList<uint>?>(nameof(Palette));

    public static readonly StyledProperty<bool> MovingProperty =
        AvaloniaProperty.Register<StudioCoverBackdrop, bool>(nameof(Moving));

    /// <summary>How wide the cover is kept, in pixels. Blurred this small it has no shapes left to show.</summary>
    public const int TextureSide = 64;

    /// <summary>The blur's sigma at <see cref="TextureSide"/>, in pixels.</summary>
    private const float BlurSigma = 5f;

    /// <summary>How far each disc reaches, as a fraction of the longer side.</summary>
    private const float DiscRadius = 0.42f;

    private static readonly TimeSpan PlayingPeriod = TimeSpan.FromSeconds(90);
    private const double StoppedSpeed = 0.2;
    private static readonly TimeSpan SpeedRamp = TimeSpan.FromSeconds(1.5);
    private static readonly TimeSpan CoverFade = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan Frame = TimeSpan.FromMilliseconds(50);

    private const string Sksl = """
        uniform shader fromTex;
        uniform shader toTex;
        uniform float2 size;
        uniform float texSide;
        uniform float zoom;
        uniform float3 disc1;
        uniform float3 disc2;
        uniform float2 weights;
        uniform float radius;
        uniform float fade;
        uniform float2 dims;

        float2 turn(float2 v, float a) {
            float c = cos(a);
            float s = sin(a);
            return float2(c * v.x - s * v.y, s * v.x + c * v.y);
        }

        float3 cover(float2 uv) {
            float2 t = uv * texSide;
            float3 a = float3(fromTex.eval(t).rgb) * dims.x;
            float3 b = float3(toTex.eval(t).rgb) * dims.y;
            return mix(a, b, fade);
        }

        half4 main(float2 p) {
            float side = max(size.x, size.y);
            float2 q = (p - size * 0.5) / side;
            float3 colour = cover(q / zoom + 0.5);

            float2 d1 = q - disc1.xy;
            float m1 = 1.0 - smoothstep(radius * 0.3, radius, length(d1));
            colour = mix(colour, cover(turn(d1, disc1.z) / zoom + 0.5), m1 * weights.x);

            float2 d2 = q - disc2.xy;
            float m2 = 1.0 - smoothstep(radius * 0.3, radius, length(d2));
            colour = mix(colour, cover(turn(d2, disc2.z) / zoom + 0.5), m2 * weights.y);

            float n = fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453);
            colour += (n - 0.5) * (2.0 / 255.0);
            return half4(half3(clamp(colour, 0.0, 1.0)), 1.0);
        }
        """;

    private static readonly Lazy<SKRuntimeEffect?> Shader = new(() =>
    {
        var effect = SKRuntimeEffect.CreateShader(Sksl, out var errors);
        if (effect is null)
        {
            System.Diagnostics.Debug.WriteLine($"Studio's cover shader did not compile: {errors}");
        }

        return effect;
    });

    private static readonly Lazy<Texture> NoCover = new(() => Solid(StudioDrift.NoCover));

    private DispatcherTimer? _timer;
    private DateTimeOffset _last;
    private double _phase;
    private double _speed = StoppedSpeed;
    private Texture _from = NoCover.Value;
    private Texture _to = NoCover.Value;
    private IReadOnlyList<uint> _paletteFrom = [];
    private IReadOnlyList<uint> _paletteTo = [];
    private double _fade = 1;

    /// <summary>Set from the render thread when the canvas could not be leased; read on the UI thread.</summary>
    private volatile bool _noSkia;

    public StudioCoverBackdrop()
    {
        IsHitTestVisible = false;
    }

    /// <summary>The on-air cover. Null for none.</summary>
    public Bitmap? Cover
    {
        get => GetValue(CoverProperty);
        set => SetValue(CoverProperty, value);
    }

    /// <summary>The cover's colours, for the gradients this falls back to without Skia.</summary>
    public IReadOnlyList<uint>? Palette
    {
        get => GetValue(PaletteProperty);
        set => SetValue(PaletteProperty, value);
    }

    /// <summary>Whether the station is playing here, which is what sets it going at full speed.</summary>
    public bool Moving
    {
        get => GetValue(MovingProperty);
        set => SetValue(MovingProperty, value);
    }

    /// <summary>Where in the loop it starts, for a screenshot that wants it somewhere particular.</summary>
    public double Phase
    {
        get => _phase;
        set
        {
            _phase = value;
            InvalidateVisual();
        }
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == CoverProperty)
        {
            // A cover changing mid-fade starts from whichever of the two was showing more, rather than
            // keeping three textures for one moment nobody will see.
            _from = _fade < 0.5 ? _from : _to;
            _to = Cover is { } cover ? Prepare(cover) : NoCover.Value;
            _fade = IsRunning ? 0 : 1;
            InvalidateVisual();
        }
        else if (change.Property == PaletteProperty)
        {
            _paletteFrom = StudioDrift.Blend(_paletteFrom, _paletteTo, _fade);
            _paletteTo = Palette is { } palette ? CoverColours.Backdrop(palette, StudioDrift.Patches) : [];
            InvalidateVisual();
        }
        else if (change.Property == IsVisibleProperty)
        {
            Run(IsEffectivelyVisible && VisualRoot is not null);
        }
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        Run(IsEffectivelyVisible);
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        Run(false);
        base.OnDetachedFromVisualTree(e);
    }

    public override void Render(DrawingContext context)
    {
        var bounds = new Rect(Bounds.Size);

        if (_noSkia || Shader.Value is null)
        {
            StudioBackdrop.Paint(context, bounds, StudioDrift.Blend(_paletteFrom, _paletteTo, _fade),
                StudioDrift.Mix(StudioDrift.Ground(_paletteFrom), StudioDrift.Ground(_paletteTo), _fade), _phase);
            return;
        }

        context.Custom(new Draw(this, bounds, new Scene(
            _from,
            _to,
            StudioCoverMotion.FadeWeight(_fade),
            StudioCoverMotion.Zoom(_phase),
            StudioCoverMotion.Discs(_phase))));
    }

    private bool IsRunning => _timer is not null;

    private nint Window() =>
        TopLevel.GetTopLevel(this)?.TryGetPlatformHandle() is IMacOSTopLevelPlatformHandle mac ? mac.NSWindow : 0;

    private void Run(bool run)
    {
        if (run == IsRunning)
        {
            return;
        }

        if (!run)
        {
            _timer?.Stop();
            _timer = null;
            return;
        }

        if (StudioBackdrop.Facts?.ReduceMotion == true)
        {
            InvalidateVisual();
            return;
        }

        _last = DateTimeOffset.UtcNow;
        _timer = new DispatcherTimer { Interval = Frame };
        _timer.Tick += (_, _) => Step();
        _timer.Start();
    }

    private void Step()
    {
        var now = DateTimeOffset.UtcNow;
        var elapsed = now - _last;
        _last = now;

        if (StudioBackdrop.Facts?.IsSeen(Window()) == false)
        {
            return;
        }

        _speed = StudioDrift.Ease(_speed, Moving ? 1 : StoppedSpeed, elapsed, SpeedRamp);
        _phase = StudioDrift.Advance(_phase, elapsed * _speed, PlayingPeriod);
        _fade = Math.Min(_fade + elapsed / CoverFade, 1);

        InvalidateVisual();
    }

    private void FellBack()
    {
        if (_noSkia)
        {
            return;
        }

        _noSkia = true;
        Dispatcher.UIThread.Post(InvalidateVisual);
    }

    /// <summary>
    /// A cover shrunk to <see cref="TextureSide"/> square (its middle, as the cover is drawn), blurred,
    /// and how dark it is drawn. Once per cover; never per frame.
    /// </summary>
    /// <remarks>
    /// Old textures are not disposed by hand: a frame already queued on the render thread may still be
    /// sampling one, and Skia's objects release their native side when they are collected.
    /// </remarks>
    private static Texture Prepare(Bitmap cover)
    {
        var size = cover.PixelSize;
        var stride = size.Width * 4;
        var bytes = new byte[stride * size.Height];
        var handle = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try
        {
            cover.CopyPixels(new PixelRect(size), handle.AddrOfPinnedObject(), bytes.Length, stride);
        }
        finally
        {
            handle.Free();
        }

        var colour = cover.Format == PixelFormats.Rgba8888 ? SKColorType.Rgba8888 : SKColorType.Bgra8888;
        using var source = SKImage.FromPixelCopy(new SKImageInfo(size.Width, size.Height, colour, SKAlphaType.Premul), bytes, stride);

        var square = Math.Min(size.Width, size.Height);
        var crop = SKRect.Create((size.Width - square) / 2f, (size.Height - square) / 2f, square, square);
        var info = new SKImageInfo(TextureSide, TextureSide, SKColorType.Bgra8888, SKAlphaType.Premul);

        using var small = SKSurface.Create(info);
        small.Canvas.DrawImage(source, crop, SKRect.Create(TextureSide, TextureSide),
            new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        using var shrunk = small.Snapshot();

        using var blurred = SKSurface.Create(info);
        using (var blur = new SKPaint { ImageFilter = SKImageFilter.CreateBlur(BlurSigma, BlurSigma, SKShaderTileMode.Clamp) })
        {
            blurred.Canvas.DrawImage(shrunk, 0, 0, blur);
        }

        var image = blurred.Snapshot().ToRasterImage();

        var pixels = new uint[TextureSide * TextureSide];
        var pinned = GCHandle.Alloc(pixels, GCHandleType.Pinned);
        try
        {
            image.ReadPixels(new SKImageInfo(TextureSide, TextureSide, SKColorType.Bgra8888, SKAlphaType.Unpremul),
                pinned.AddrOfPinnedObject(), TextureSide * 4, 0, 0);
        }
        finally
        {
            pinned.Free();
        }

        return new Texture(image, (float)StudioCoverMotion.Dim(pixels));
    }

    private static Texture Solid(uint argb)
    {
        using var surface = SKSurface.Create(new SKImageInfo(1, 1, SKColorType.Bgra8888, SKAlphaType.Premul));
        surface.Canvas.Clear(new SKColor(argb));
        return new Texture(surface.Snapshot().ToRasterImage(), 1f);
    }

    /// <summary>A prepared cover: the blurred image, its shader, and how dark it is drawn.</summary>
    private sealed class Texture(SKImage image, float dim)
    {
        public SKShader Shader { get; } = image.ToShader(SKShaderTileMode.Clamp, SKShaderTileMode.Clamp,
            new SKSamplingOptions(SKCubicResampler.Mitchell));

        public float Dim { get; } = dim;

        // Held so the image lives as long as its shader does.
        public SKImage Image { get; } = image;
    }

    /// <summary>One frame's worth of everything the shader is told, taken on the UI thread.</summary>
    private sealed record Scene(Texture From, Texture To, double Fade, double Zoom, IReadOnlyList<CoverDisc> Discs);

    private sealed class Draw(StudioCoverBackdrop owner, Rect bounds, Scene scene) : ICustomDrawOperation
    {
        public Rect Bounds { get; } = bounds;

        public void Dispose()
        {
        }

        public bool Equals(ICustomDrawOperation? other) => false;

        public bool HitTest(Point p) => false;

        public void Render(ImmediateDrawingContext context)
        {
            if (context.TryGetFeature<ISkiaSharpApiLeaseFeature>() is not { } feature || Shader.Value is not { } effect)
            {
                owner.FellBack();
                return;
            }

            using var lease = feature.Lease();
            var canvas = lease.SkCanvas;

            var (d1, d2) = (scene.Discs[0], scene.Discs[1]);
            var builder = new SKRuntimeShaderBuilder(effect);
            builder.Children["fromTex"] = scene.From.Shader;
            builder.Children["toTex"] = scene.To.Shader;
            builder.Uniforms["size"] = new[] { (float)Bounds.Width, (float)Bounds.Height };
            builder.Uniforms["texSide"] = (float)TextureSide;
            builder.Uniforms["zoom"] = (float)scene.Zoom;
            builder.Uniforms["disc1"] = new[] { (float)d1.X, (float)d1.Y, (float)d1.Angle };
            builder.Uniforms["disc2"] = new[] { (float)d2.X, (float)d2.Y, (float)d2.Angle };
            builder.Uniforms["weights"] = new[] { (float)d1.Weight, (float)d2.Weight };
            builder.Uniforms["radius"] = DiscRadius;
            builder.Uniforms["fade"] = (float)scene.Fade;
            builder.Uniforms["dims"] = new[] { scene.From.Dim, scene.To.Dim };

            using var shader = builder.Build();
            using var paint = new SKPaint { Shader = shader };
            canvas.DrawRect(SKRect.Create((float)Bounds.Width, (float)Bounds.Height), paint);
        }
    }
}
