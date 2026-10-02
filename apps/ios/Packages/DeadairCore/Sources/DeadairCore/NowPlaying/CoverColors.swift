import Foundation

/// A colour as 0xRRGGBB, opaque, so the rules are arithmetic a test can read. `apps/android`'s ARGB ints.
public typealias RGB = UInt32

/// The colour Now playing takes from a cover, and the colour that reads on it.
public struct CoverAccent: Equatable, Sendable {
    public let accent: RGB
    public let onAccent: RGB
}

/// What Now playing and Up next take from a cover: the accent the controls wear, and the mesh behind them.
public struct CoverPalette: Equatable, Sendable {
    /// `nil` on a cover with no colour worth a button: the controls keep the app's own accent.
    public let accent: CoverAccent?
    /// Empty only when the cover gave no colours at all.
    public let mesh: [RGB]

    public init(candidates: [RGB], darkPage: Bool) {
        accent = coverAccent(candidates, darkPage: darkPage)
        mesh = meshColors(candidates, darkPage: darkPage)
    }
}

/// How many blobs the mesh has.
public let meshBlobs = 4

/// Which of a cover's colours Now playing wears, or `nil` to keep the app's own.
///
/// Three decisions. The MOST COLOURFUL candidate wins rather than the most common one, because a cover
/// is mostly its background and the colour worth carrying onto a button is the one that stands out of
/// it. A cover with no colour worth the name (black and white, a grey photograph) answers `nil`, since
/// a grey play button is a disabled-looking one. And the winner's lightness is pulled into a band that
/// reads on the page, lighter on a dark page and darker on a light one, keeping its hue and saturation.
/// `apps/android`'s `coverAccent`, line for line.
public func coverAccent(_ candidates: [RGB], darkPage: Bool) -> CoverAccent? {
    guard let best = candidates.max(by: { chroma($0) < chroma($1) }), chroma(best) >= minChroma else { return nil }
    let (hue, saturation, lightness) = hsl(best)
    let band = darkPage ? darkPageBand : lightPageBand
    let accent = fromHsl(hue, saturation, min(max(lightness, band.lowerBound), band.upperBound))
    return CoverAccent(accent: accent, onAccent: readableOn(accent))
}

/// The four colours the mesh is painted in, or empty to paint none.
///
/// All of the cover's colours are used, greys included: the mesh is a cover's mood rather than a
/// control. Each keeps its hue and saturation and has its lightness pulled into a band that GLOWS
/// against the page. A cover that gives fewer than four colours has them repeated, and a repeated
/// colour's copies are spread evenly across the band, so no two blobs are ever the same patch.
/// `apps/android`'s `meshColors`.
public func meshColors(_ candidates: [RGB], darkPage: Bool) -> [RGB] {
    var seen = Set<RGB>()
    let distinct = candidates.filter { seen.insert($0).inserted }
    guard !distinct.isEmpty else { return [] }
    let band = darkPage ? darkMeshBand : lightMeshBand
    return (0..<meshBlobs).map { index in
        let colour = index % distinct.count
        let (hue, saturation, lightness) = hsl(distinct[colour])
        // How many blobs this one colour paints, and which of them this is.
        let copies = (meshBlobs - colour + distinct.count - 1) / distinct.count
        let copy = index / distinct.count
        let placed = copies == 1
            ? min(max(lightness, band.lowerBound), band.upperBound)
            : band.lowerBound + (band.upperBound - band.lowerBound) * (Double(copy) + 0.5) / Double(copies)
        return fromHsl(hue, saturation, placed)
    }
}

/// Black or white, whichever contrasts more with `background`.
public func readableOn(_ background: RGB) -> RGB {
    let l = luminance(background)
    return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? 0x000000 : 0xFFFFFF
}

private let minChroma = 0.12
private let darkPageBand = 0.58...0.78
private let lightPageBand = 0.28...0.45
private let darkMeshBand = 0.22...0.5
private let lightMeshBand = 0.6...0.85

func channels(_ rgb: RGB) -> (Double, Double, Double) {
    (Double((rgb >> 16) & 0xFF) / 255, Double((rgb >> 8) & 0xFF) / 255, Double(rgb & 0xFF) / 255)
}

/// How far a colour is from grey: the spread between its strongest and weakest channel.
private func chroma(_ rgb: RGB) -> Double {
    let (r, g, b) = channels(rgb)
    return max(r, g, b) - min(r, g, b)
}

private func hsl(_ rgb: RGB) -> (Double, Double, Double) {
    let (r, g, b) = channels(rgb)
    let high = max(r, g, b), low = min(r, g, b)
    let lightness = (high + low) / 2
    let delta = high - low
    guard delta > 0 else { return (0, 0, lightness) }
    let saturation = delta / (1 - abs(2 * lightness - 1))
    var hue: Double
    if high == r {
        hue = 60 * ((g - b) / delta).truncatingRemainder(dividingBy: 6)
        if hue < 0 { hue += 360 }
    } else if high == g {
        hue = 60 * ((b - r) / delta + 2)
    } else {
        hue = 60 * ((r - g) / delta + 4)
    }
    return (hue, min(max(saturation, 0), 1), lightness)
}

private func fromHsl(_ hue: Double, _ saturation: Double, _ lightness: Double) -> RGB {
    let c = (1 - abs(2 * lightness - 1)) * saturation
    var sector = (hue / 60).truncatingRemainder(dividingBy: 2)
    if sector < 0 { sector += 2 }
    let x = c * (1 - abs(sector - 1))
    let m = lightness - c / 2
    let (r, g, b): (Double, Double, Double) =
        switch hue {
        case ..<60: (c, x, 0)
        case ..<120: (x, c, 0)
        case ..<180: (0, c, x)
        case ..<240: (0, x, c)
        case ..<300: (x, 0, c)
        default: (c, 0, x)
        }
    func byte(_ v: Double) -> RGB { RGB(min(max(Int((v + m) * 255), 0), 255)) }
    return (byte(r) << 16) | (byte(g) << 8) | byte(b)
}

/// WCAG relative luminance.
private func luminance(_ rgb: RGB) -> Double {
    let (r, g, b) = channels(rgb)
    func linear(_ v: Double) -> Double { v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}
