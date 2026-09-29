using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using MaroonedSoftware.Deadair.Desktop.Core.Programme;

namespace MaroonedSoftware.Deadair.Desktop.Controls;

/// <summary>
/// The format clock drawn as the instrument it is named after: one hour of a clock face, with a mark
/// wherever a band falls.
/// </summary>
/// <remarks>
/// <para>
/// Beside the list and never instead of it. The list is the editor, since a band is four fields and
/// nobody types into a circle; what rows cannot show is the SHAPE of an hour, that the ident at :00,
/// the news at :30 and the weather at :55 leave one long stretch of music and two short ones, or that
/// three rules have piled up inside four minutes. The web console draws the same dial for that reason.
/// </para>
/// <para>
/// Read-only and drawn in one <see cref="Render"/> rather than built from positioned controls:
/// nothing on it is clickable, and a dozen rotated borders would be a layout pass for a picture. The
/// hole in the middle carries a count and never a playhead, because a second clock disagreeing with
/// the one on the bar is worse than none.
/// </para>
/// </remarks>
public sealed class FormatClockDial : Control
{
    public static readonly StyledProperty<IReadOnlyList<DialMark>?> MarksProperty =
        AvaloniaProperty.Register<FormatClockDial, IReadOnlyList<DialMark>?>(nameof(Marks));

    public static readonly StyledProperty<IBrush?> RimProperty =
        AvaloniaProperty.Register<FormatClockDial, IBrush?>(nameof(Rim));

    public static readonly StyledProperty<IBrush?> FaceProperty =
        AvaloniaProperty.Register<FormatClockDial, IBrush?>(nameof(Face));

    public static readonly StyledProperty<IBrush?> MarkProperty =
        AvaloniaProperty.Register<FormatClockDial, IBrush?>(nameof(Mark));

    public static readonly StyledProperty<IBrush?> WarningProperty =
        AvaloniaProperty.Register<FormatClockDial, IBrush?>(nameof(Warning));

    public static readonly StyledProperty<IBrush?> TextProperty =
        AvaloniaProperty.Register<FormatClockDial, IBrush?>(nameof(Text));

    public static readonly StyledProperty<FontFamily> FontFamilyProperty =
        TextBlock.FontFamilyProperty.AddOwner<FormatClockDial>();

    static FormatClockDial()
    {
        AffectsRender<FormatClockDial>(MarksProperty, RimProperty, FaceProperty, MarkProperty, WarningProperty, TextProperty);
    }

    /// <summary>What to draw, from <see cref="FormatClock.Marks"/>.</summary>
    public IReadOnlyList<DialMark>? Marks
    {
        get => GetValue(MarksProperty);
        set => SetValue(MarksProperty, value);
    }

    /// <summary>The ruler: the rim, the quarter ticks and the hole.</summary>
    public IBrush? Rim
    {
        get => GetValue(RimProperty);
        set => SetValue(RimProperty, value);
    }

    public IBrush? Face
    {
        get => GetValue(FaceProperty);
        set => SetValue(FaceProperty, value);
    }

    /// <summary>A band the station can make.</summary>
    public IBrush? Mark
    {
        get => GetValue(MarkProperty);
        set => SetValue(MarkProperty, value);
    }

    /// <summary>A band nothing on the station can make, which will be claimed and passed over.</summary>
    public IBrush? Warning
    {
        get => GetValue(WarningProperty);
        set => SetValue(WarningProperty, value);
    }

    public IBrush? Text
    {
        get => GetValue(TextProperty);
        set => SetValue(TextProperty, value);
    }

    public FontFamily FontFamily
    {
        get => GetValue(FontFamilyProperty);
        set => SetValue(FontFamilyProperty, value);
    }

    protected override Size MeasureOverride(Size availableSize) => new(Diameter, Diameter);

    /// <summary>The web console's 220, which leaves room inside the rim for a label at every quarter.</summary>
    private const double Diameter = 220;

    public override void Render(DrawingContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        // Nothing to draw into until layout has given it room, and the hole's text would have a
        // negative width.
        const double hole = 62;
        var radius = Math.Min(Bounds.Width, Bounds.Height) / 2;
        if (radius <= hole + 8)
        {
            return;
        }

        var centre = new Point(Bounds.Width / 2, Bounds.Height / 2);
        var rim = new Pen(Rim, 1);

        context.DrawEllipse(Face, rim, centre, radius - 0.5, radius - 0.5);

        // Quarters, so a mark reads as "about twenty past" without counting. In the rim's own colour:
        // they are a ruler, not content.
        var ruler = new Pen(Rim, 2, lineCap: PenLineCap.Round);
        foreach (var minute in new[] { 0, 15, 30, 45 })
        {
            Tick(context, ruler, centre, radius - 4, minute, 7);
        }

        var marks = Marks ?? [];
        foreach (var mark in marks)
        {
            Tick(context, new Pen(mark.Unproducible ? Warning : Mark, 2, lineCap: PenLineCap.Round), centre, radius - 4, mark.Minute, 18);
        }

        var typeface = new Typeface(FontFamily);
        // Each label just inside the rim at its own angle, stepped inward when it would land on one
        // already drawn: ":55" and ":00" are thirty degrees apart and drew over each other.
        var placed = new List<Rect>();
        foreach (var mark in marks.OrderBy(mark => mark.Minute))
        {
            var angle = ((mark.Minute / 60d * 360) - 90) * Math.PI / 180;
            var text = Words(mark.Label, typeface, 11);
            var box = default(Rect);
            for (var step = 0; step < 3; step++)
            {
                var distance = radius - 40 - (step * (text.Height + 2));
                var at = new Point(centre.X + (Math.Cos(angle) * distance), centre.Y + (Math.Sin(angle) * distance));
                box = new Rect(at.X - (text.Width / 2), at.Y - (text.Height / 2), text.Width, text.Height);
                if (!placed.Any(other => other.Intersects(box)))
                {
                    break;
                }
            }

            placed.Add(box);
            context.DrawText(text, box.TopLeft);
        }

        context.DrawEllipse(null, new Pen(Rim, 1), centre, radius - hole, radius - hole);

        var count = marks.Count switch
        {
            0 => "nothing on the hour",
            1 => "1 break an hour",
            var many => string.Create(CultureInfo.InvariantCulture, $"{many} breaks an hour"),
        };
        var middle = Words(count, typeface, 11);
        middle.MaxTextWidth = (radius - hole) * 2 - 12;
        middle.TextAlignment = TextAlignment.Center;
        context.DrawText(middle, new Point(centre.X - (middle.MaxTextWidth / 2), centre.Y - (middle.Height / 2)));
    }

    /// <summary>One mark on the rim, standing inward from it at the angle a minute sits at.</summary>
    private static void Tick(DrawingContext context, Pen pen, Point centre, double outer, int minute, double length)
    {
        // Minutes run clockwise from the top.
        var angle = ((minute / 60d * 360) - 90) * Math.PI / 180;
        var (cos, sin) = (Math.Cos(angle), Math.Sin(angle));
        context.DrawLine(
            pen,
            new Point(centre.X + (cos * outer), centre.Y + (sin * outer)),
            new Point(centre.X + (cos * (outer - length)), centre.Y + (sin * (outer - length))));
    }

    private FormattedText Words(string text, Typeface typeface, double size) =>
        new(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, typeface, size, Text);
}
