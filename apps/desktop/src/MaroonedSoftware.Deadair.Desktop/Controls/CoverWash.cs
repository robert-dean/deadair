using Avalonia;
using Avalonia.Controls;
using Avalonia.Media;
using Avalonia.Styling;
using MaroonedSoftware.Deadair.Desktop.Core.NowPlaying;

namespace MaroonedSoftware.Deadair.Desktop.Controls;

/// <summary>
/// The on-air cover's colour, washed down the top of the page and fading into it.
/// </summary>
/// <remarks>
/// A web player heads its page in the cover's colour. The colour is chosen by
/// <see cref="CoverColours.HeaderTint"/> for the appearance the control is drawn in, and chosen again
/// when that changes, because the same cover wants a dim wash under white type and a pale one under
/// black. It fades to transparent rather than to the panel's colour, so it needs no colour of the
/// panel's own and cannot draw a seam where the two differ.
/// </remarks>
public sealed class CoverWash : Border
{
    public static readonly StyledProperty<IReadOnlyList<uint>?> PaletteProperty =
        AvaloniaProperty.Register<CoverWash, IReadOnlyList<uint>?>(nameof(Palette));

    public CoverWash()
    {
        IsHitTestVisible = false;
        ActualThemeVariantChanged += (_, _) => Update();
    }

    /// <summary>The cover's colours, as <see cref="CoverColours.Candidates"/> gives them. Null for no cover.</summary>
    public IReadOnlyList<uint>? Palette
    {
        get => GetValue(PaletteProperty);
        set => SetValue(PaletteProperty, value);
    }

    protected override void OnPropertyChanged(AvaloniaPropertyChangedEventArgs change)
    {
        base.OnPropertyChanged(change);

        if (change.Property == PaletteProperty)
        {
            Update();
        }
    }

    private void Update()
    {
        var dark = ActualThemeVariant == ThemeVariant.Dark;
        if (Palette is not { Count: > 0 } palette || CoverColours.HeaderTint(palette, dark) is not { } tint)
        {
            Background = null;
            return;
        }

        var top = Color.FromUInt32(tint);
        Background = new LinearGradientBrush
        {
            StartPoint = new RelativePoint(0, 0, RelativeUnit.Relative),
            EndPoint = new RelativePoint(0, 1, RelativeUnit.Relative),
            GradientStops =
            {
                new GradientStop(top, 0),
                new GradientStop(Color.FromArgb(0, top.R, top.G, top.B), 1),
            },
        };
    }
}
