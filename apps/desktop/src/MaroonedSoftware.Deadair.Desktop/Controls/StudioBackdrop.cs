using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Platform;
using Avalonia.Threading;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;
using MaroonedSoftware.Deadair.Desktop.Core.Ui;

namespace MaroonedSoftware.Deadair.Desktop.Controls;

/// <summary>
/// Studio's backdrop: the on-air cover's colours as soft patches drifting slowly over a darker ground.
/// </summary>
/// <remarks>
/// <para>
/// The motion and the colours are Core's (<see cref="StudioDrift"/>, <see cref="CoverColours.Backdrop"/>);
/// this owns only the clock and the drawing. The clock runs while the control is in a window and its OWN
/// <c>IsVisible</c> is true, and not otherwise, so a Studio nobody has open costs nothing. Its own,
/// because Avalonia tells a control when it is hidden and not when a parent is: whoever shows it binds
/// its visibility on the backdrop itself.
/// </para>
/// <para>
/// Twenty frames a second, not the display's rate: a patch goes round its path once in a minute and a
/// half, which at 20 Hz is a pixel or two a frame on a large screen. Drawing it sixty times a second would
/// be the same picture for three times the work, on a screen that may be left on all evening.
/// </para>
/// <para>
/// It holds still, with no clock at all, for somebody who has asked their Mac for less motion, read
/// each time it starts so a change in System Settings applies the next time Studio opens. And it draws
/// nothing while no part of its window can be seen (another app full screen over it, the window hidden
/// or on another Space), keeping its place so it carries on from where it was rather than jumping.
/// Both answers come from <see cref="Facts"/>, which is null in a headless render and then changes
/// nothing.
/// </para>
/// </remarks>
public sealed class StudioBackdrop : Control
{
    public static readonly StyledProperty<IReadOnlyList<uint>?> PaletteProperty =
        AvaloniaProperty.Register<StudioBackdrop, IReadOnlyList<uint>?>(nameof(Palette));

    public static readonly StyledProperty<bool> MovingProperty =
        AvaloniaProperty.Register<StudioBackdrop, bool>(nameof(Moving));

    /// <summary>Once round the loop while the station is playing here.</summary>
    private static readonly TimeSpan PlayingPeriod = TimeSpan.FromSeconds(90);

    /// <summary>How much slower it goes while stopped: still alive, but resting.</summary>
    private const double StoppedSpeed = 0.2;

    private static readonly TimeSpan SpeedRamp = TimeSpan.FromSeconds(1.5);
    private static readonly TimeSpan ColourFade = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan Frame = TimeSpan.FromMilliseconds(50);

    private DispatcherTimer? _timer;
    private DateTimeOffset _last;
    private double _phase;
    private double _speed = StoppedSpeed;
    private IReadOnlyList<uint> _from = [];
    private IReadOnlyList<uint> _to = [];
    private double _fade = 1;

    /// <summary>What the system says about motion and about the window being seen. Set once by the app.</summary>
    /// <remarks>Static for the reason <c>ArtworkLoader.Shared</c> is: XAML builds controls and can hand them nothing.</remarks>
    public static IScreenFacts? Facts { get; set; }

    public StudioBackdrop()
    {
        IsHitTestVisible = false;
    }

    /// <summary>The cover's colours as <see cref="CoverColours.Candidates"/> gives them. Null for no cover.</summary>
    public IReadOnlyList<uint>? Palette
    {
        get => GetValue(PaletteProperty);
        set => SetValue(PaletteProperty, value);
    }

    /// <summary>Whether the station is playing here, which is what sets the drift going at full speed.</summary>
    public bool Moving
    {
        get => GetValue(MovingProperty);
        set => SetValue(MovingProperty, value);
    }

    /// <summary>Where in the loop it starts, for a screenshot that wants the patches somewhere particular.</summary>
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

        if (change.Property == PaletteProperty)
        {
            // From wherever the fade had got to, so a record that changes mid-fade does not snap back.
            _from = StudioDrift.Blend(_from, _to, _fade);
            _to = Palette is { } palette ? CoverColours.Backdrop(palette, StudioDrift.Patches) : [];
            _fade = IsRunning ? 0 : 1;
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
        var colours = StudioDrift.Blend(_from, _to, _fade);
        var ground = StudioDrift.Mix(StudioDrift.Ground(_from), StudioDrift.Ground(_to), _fade);

        context.FillRectangle(new SolidColorBrush(Color.FromUInt32(ground)), bounds);

        var reach = Math.Max(bounds.Width, bounds.Height);
        var patches = StudioDrift.At(_phase);
        for (var index = 0; index < patches.Count; index++)
        {
            var patch = patches[index];
            var colour = Color.FromUInt32(colours[index]);
            var radius = patch.Radius * reach;
            var brush = new RadialGradientBrush
            {
                GradientStops =
                {
                    new GradientStop(colour, 0),
                    new GradientStop(Color.FromArgb(0x90, colour.R, colour.G, colour.B), 0.45),
                    new GradientStop(Color.FromArgb(0, colour.R, colour.G, colour.B), 1),
                },
            };

            context.DrawEllipse(brush, null, new Point(patch.X * bounds.Width, patch.Y * bounds.Height), radius, radius);
        }
    }

    private bool IsRunning => _timer is not null;

    /// <summary>The platform's own window, where the platform has one to give.</summary>
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

        if (Facts?.ReduceMotion == true)
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

        if (Facts?.IsSeen(Window()) == false)
        {
            return;
        }

        _speed = StudioDrift.Ease(_speed, Moving ? 1 : StoppedSpeed, elapsed, SpeedRamp);
        _phase = StudioDrift.Advance(_phase, elapsed * _speed, PlayingPeriod);
        _fade = Math.Min(_fade + elapsed / ColourFade, 1);

        InvalidateVisual();
    }
}
