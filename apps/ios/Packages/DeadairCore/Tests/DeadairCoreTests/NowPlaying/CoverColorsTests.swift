@testable import DeadairCore
import Testing

/// Which of a cover's colours Now playing wears, and that it reads on the page it is worn on.
/// `apps/android`'s `CoverAccentTest`, case for case.
struct CoverColorsTests {
    private let black: RGB = 0x000000
    private let white: RGB = 0xFFFFFF
    private let grassGreen: RGB = 0x3A9A4A
    private let offWhite: RGB = 0xEDE8E0
    private let navy: RGB = 0x14244A
    private let paleYellow: RGB = 0xF8EFA0

    private func red(_ c: RGB) -> Int { Int((c >> 16) & 0xFF) }
    private func green(_ c: RGB) -> Int { Int((c >> 8) & 0xFF) }
    private func blue(_ c: RGB) -> Int { Int(c & 0xFF) }
    private func lightness(_ c: RGB) -> Int { (max(red(c), green(c), blue(c)) + min(red(c), green(c), blue(c))) / 2 }

    @Test func wearsTheMostColourfulOfTheCoversColoursNotItsBackground() {
        let accent = coverAccent([offWhite, grassGreen, black], darkPage: true)!.accent
        #expect(green(accent) > red(accent) && green(accent) > blue(accent))
    }

    @Test func keepsTheThemeForACoverWithNoColourInIt() {
        #expect(coverAccent([black, white, 0x808080], darkPage: true) == nil)
    }

    @Test func keepsTheThemeWhenTheCoverGaveNothing() {
        #expect(coverAccent([], darkPage: true) == nil)
    }

    @Test func liftsADarkColourUntilItReadsOnADarkPageKeepingItBlue() {
        let accent = coverAccent([navy], darkPage: true)!.accent
        #expect(lightness(accent) > lightness(navy))
        #expect(blue(accent) > red(accent) && blue(accent) > green(accent))
    }

    @Test func darkensAPaleColourUntilItReadsOnALightPage() {
        #expect(lightness(coverAccent([paleYellow], darkPage: false)!.accent) < lightness(paleYellow))
    }

    @Test func putsBlackOnALightAccentAndWhiteOnADarkOne() {
        #expect(coverAccent([paleYellow], darkPage: true)!.onAccent == black)
        #expect(coverAccent([navy], darkPage: false)!.onAccent == white)
    }

    @Test func readsBlackOnWhiteAndWhiteOnBlack() {
        #expect(readableOn(white) == black)
        #expect(readableOn(black) == white)
    }

    @Test func paintsNoMeshWhenTheCoverGaveNoColours() {
        #expect(meshColors([], darkPage: true).isEmpty)
    }

    @Test func alwaysPaintsFourBlobsHoweverFewColoursTheCoverGave() {
        #expect(meshColors([grassGreen], darkPage: true).count == 4)
        #expect(meshColors([grassGreen, navy, paleYellow], darkPage: true).count == 4)
    }

    @Test func neverPaintsTwoBlobsTheSameColourFromOneCoverColour() {
        #expect(Set(meshColors([grassGreen], darkPage: true)).count == 4)
    }

    @Test func liftsABlackCoversColourSoTheMeshShowsOnADarkPage() {
        for c in meshColors([black], darkPage: true) { #expect(lightness(c) >= 50) }
    }

    @Test func keepsABlackAndWhiteCoverGreyRatherThanInventingAColour() {
        for c in meshColors([black, white], darkPage: true) {
            #expect(red(c) == green(c))
            #expect(green(c) == blue(c))
        }
    }

    @Test func softensAPaleCoversColoursOnALightPageRatherThanGlaring() {
        for c in meshColors([white], darkPage: false) { #expect(lightness(c) < 255) }
    }
}
