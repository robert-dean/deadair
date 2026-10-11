using System.Collections;
using System.Collections.Specialized;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Threading;

namespace MaroonedSoftware.Deadair.Desktop.Controls;

/// <summary>
/// A record's timed lines, scrolled so the one being sung sits <see cref="LinesAbove"/> lines from the
/// top, the phone's lyrics sheet's rule.
/// </summary>
/// <remarks>
/// <para>
/// Which line is lit is decided in Core (<c>Lyrics.CurrentLine</c>) and carried by the rows; this
/// only moves the column. A new song jumps to its place, so a column opened half-way through is
/// already there; a line moving on glides, because a list that leaps every few seconds is hard to
/// read along with.
/// </para>
/// <para>
/// Before the first line, and in a gap, nothing is lit and the column stays where it was.
/// </para>
/// </remarks>
public partial class LyricColumn : UserControl
{
    /// <summary>How many lines stay above the lit one, so what was just sung is still in view.</summary>
    public const int LinesAbove = 2;

    private static readonly TimeSpan Glide = TimeSpan.FromMilliseconds(350);

    public static readonly StyledProperty<IEnumerable?> LinesProperty =
        AvaloniaProperty.Register<LyricColumn, IEnumerable?>(nameof(Lines));

    public static readonly StyledProperty<int> CurrentProperty =
        AvaloniaProperty.Register<LyricColumn, int>(nameof(Current), -1);

    public static readonly StyledProperty<double> LineSpacingProperty =
        AvaloniaProperty.Register<LyricColumn, double>(nameof(LineSpacing), 8);

    public static readonly StyledProperty<TextAlignment> LineAlignmentProperty =
        AvaloniaProperty.Register<LyricColumn, TextAlignment>(nameof(LineAlignment), TextAlignment.Left);

    private DispatcherTimer? _glide;
    private DateTime _glideStarted;
    private double _glideFrom;
    private double _glideTo;
    private bool _pending;
    private bool _jump = true;

    public LyricColumn()
    {
        InitializeComponent();

        // The containers only have a place once laid out, so a move asked for before that waits for
        // the next layout rather than being lost.
        LayoutUpdated += (_, _) =>
        {
            if (_pending)
            {
                Move();
            }
        };
    }

    /// <summary>The rows, <c>LyricLineViewModel</c>s.</summary>
    public IEnumerable? Lines
    {
        get => GetValue(LinesProperty);
        set => SetValue(LinesProperty, value);
    }

    /// <summary>The lit row's index, or -1 for none.</summary>
    public int Current
    {
        get => GetValue(CurrentProperty);
        set => SetValue(CurrentProperty, value);
    }

    public double LineSpacing
    {
        get => GetValue(LineSpacingProperty);
        set => SetValue(LineSpacingProperty, value);
    }

    public TextAlignment LineAlignment
    {
        get => GetValue(LineAlignmentProperty);
        set => SetValue(LineAlignmentProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == LinesProperty)
        {
            if (change.OldValue is INotifyCollectionChanged old)
            {
                old.CollectionChanged -= OnLinesChanged;
            }

            if (change.NewValue is INotifyCollectionChanged now)
            {
                now.CollectionChanged += OnLinesChanged;
            }

            Items.ItemsSource = Lines;
            Restart();
        }
        else if (change.Property == CurrentProperty)
        {
            _pending = true;
            Move();
        }
        else if (change.Property == IsVisibleProperty && IsVisible)
        {
            // Shown again after a while away: the place it was is long gone.
            _jump = true;
            _pending = true;
        }
    }

    private void OnLinesChanged(object? sender, NotifyCollectionChangedEventArgs e) => Restart();

    /// <summary>A different song: back to the top, and the next move is a jump rather than a glide.</summary>
    private void Restart()
    {
        _glide?.Stop();
        _jump = true;
        _pending = true;
        Scroller.Offset = default;
    }

    private void Move()
    {
        if (Current < 0)
        {
            _pending = false;
            return;
        }

        var row = Math.Max(Current - LinesAbove, 0);
        if (Items.ContainerFromIndex(row) is not { } container || container.Bounds.Height <= 0
            || container.TranslatePoint(default, Items) is not { } at)
        {
            return;
        }

        _pending = false;
        var room = Math.Max(Scroller.Extent.Height - Scroller.Viewport.Height, 0);
        var target = Math.Clamp(at.Y, 0, room);

        if (_jump || !IsEffectivelyVisible)
        {
            _jump = false;
            _glide?.Stop();
            Scroller.Offset = new Vector(0, target);
            return;
        }

        _glideFrom = Scroller.Offset.Y;
        _glideTo = target;
        _glideStarted = DateTime.UtcNow;

        if (_glide is null)
        {
            _glide = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(16) };
            _glide.Tick += (_, _) => Step();
        }

        _glide.Start();
    }

    private void Step()
    {
        var t = Math.Min((DateTime.UtcNow - _glideStarted) / Glide, 1);
        var eased = 1 - Math.Pow(1 - t, 3);
        Scroller.Offset = new Vector(0, _glideFrom + ((_glideTo - _glideFrom) * eased));

        if (t >= 1)
        {
            _glide?.Stop();
        }
    }
}
