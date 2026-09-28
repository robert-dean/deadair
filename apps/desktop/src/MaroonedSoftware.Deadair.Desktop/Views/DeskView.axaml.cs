using Avalonia;
using Avalonia.Controls;

namespace MaroonedSoftware.Deadair.Desktop.Views;

public partial class DeskView : UserControl
{
    /// <summary>Below this it is a thumbnail, and the bar already has one of those.</summary>
    private const double Smallest = 140;

    /// <summary>
    /// A page header's cover, as a web player sizes an album's: big enough to be the record, small
    /// enough that the title beside it is the biggest thing on the page.
    /// </summary>
    private const double Largest = 232;

    /// <summary>The bar, the gutters and the title bar, which the page never gets.</summary>
    private const double ReservedHeight = 240;

    /// <summary>What the title and the credit need beside it before they start wrapping badly.</summary>
    private const double ReservedWidth = 340;

    public DeskView()
    {
        InitializeComponent();

        // Both, and for different halves of the answer. The PAGE's bounds give the height; the hero
        // AREA's give the width, and that one moves with the Now playing panel beside the page — a
        // page-only subscription read the width before the panel had been measured and never looked
        // again, so the cover kept a size the page no longer had.
        //
        // The hero area is stretched by its column, so its width does not depend on the cover: this
        // settles rather than oscillating.
        PropertyChanged += OnResized;
        HeroArea.PropertyChanged += OnResized;
    }

    /// <summary>
    /// The cover takes what the window can spare.
    /// </summary>
    /// <remarks>
    /// In code rather than in a converter or a breakpoint style, because it is arithmetic on this
    /// page's own height and nothing else needs the answer. A fixed 320 was fine at the default size
    /// and clipped at the 520 minimum, where the bar and the gutters have already taken 240 of it.
    /// </remarks>
    private void OnResized(object? sender, AvaloniaPropertyChangedEventArgs e)
    {
        if (e.Property != BoundsProperty)
        {
            return;
        }

        if (Bounds.Height <= 0 || HeroArea.Bounds.Width <= 0)
        {
            return;
        }

        // Both dimensions, because the Now playing panel takes 328 of the width and nothing takes any
        // of the height. Sizing on height alone drew a 400px cover into a 520px column and left the
        // eyebrow row stacking one word per line.
        var room = Math.Min(Bounds.Height - ReservedHeight, HeroArea.Bounds.Width - ReservedWidth);

        // In a narrow page the words alone take the whole column: there is no size at which a cover
        // both fits and is a cover. So it stands down rather than being squeezed to a stamp, and the
        // record still has its artwork in the bar, which is on every page including this one.
        //
        // An early return here instead is what once drew a card over the cover: the size was
        // negative, the method gave up, and the cover kept whatever the XAML had said.
        Cover.IsVisible = room >= Smallest;

        if (Cover.IsVisible)
        {
            Cover.Width = Cover.Height = Math.Min(room, Largest);
        }
    }
}
