@testable import DeadairCore
import DeadairSdk
import Testing

/// What a plan sends. `apps/android`'s `PlanUiStateTest`, case for case.
struct PlanUiStateTests {
    private func state(
        scope: PlanScope = .keep, brief: String = "", currentBrief: String? = "heavy metal hits", somethingOn: Bool = true,
        personaId: String? = nil, eraFrom: String = "", eraTo: String = "", mode: StationMode = .rotation, onEnd: StationOnEnd = .extend, callins: Bool = false
    ) -> PlanUiState {
        PlanUiState(
            scope: scope,
            form: PlanForm(brief: brief, personaId: personaId, eraFrom: eraFrom, eraTo: eraTo, mode: mode, onEnd: onEnd, callins: callins),
            currentBrief: currentBrief,
            somethingOn: somethingOn
        )
    }

    @Test func nothingOnAirIsNotAChoiceSoTheQuestionIsNotAsked() {
        let off = state(scope: .keep, somethingOn: false)
        #expect(!off.showsScope)
        #expect(!off.keeping)
        // And there is nothing to warn about replacing, because there is nothing on.
        #expect(!off.warnsReplacing)
    }

    @Test func keepingIsOnlyKeepingWhileSomethingIsOn() {
        #expect(state(scope: .keep).keeping)
        #expect(!state(scope: .new).keeping)
        #expect(state(scope: .new).warnsReplacing)
    }

    @Test func aReplanOfWordsNobodyChangedAsksForNothing() {
        #expect(state(brief: "heavy metal hits", currentBrief: "heavy metal hits").replanInput().brief == nil)
    }

    @Test func aStraySpaceAroundTheStoredWordsIsNotAChange() {
        #expect(state(brief: "heavy metal hits", currentBrief: "  heavy metal hits  ").replanInput().brief == nil)
    }

    @Test func newWordsAreSentTrimmed() {
        #expect(state(brief: "  warm and unhurried ", currentBrief: "heavy metal hits").replanInput().brief == "warm and unhurried")
    }

    @Test func clearingABriefThatExistedSendsTheEmptyStringWhichIsWhatClearsIt() {
        #expect(state(brief: "", currentBrief: "heavy metal hits").replanInput().brief == "")
    }

    @Test func clearingABriefThatNeverExistedAsksForNothing() {
        #expect(state(brief: "", currentBrief: nil).replanInput().brief == nil)
        #expect(state(brief: "   ", currentBrief: "").replanInput().brief == nil)
    }

    @Test func aReplanNeverNamesACount() {
        #expect(state(brief: "new words", currentBrief: "old").replanInput().count == nil)
    }

    @Test func replanningIsAlwaysAllowed() {
        #expect(state(brief: "", currentBrief: "heavy metal hits").canSubmit)
    }

    @Test func aNewShowNeedsWords() {
        #expect(!state(scope: .new, brief: "   ").canSubmit)
        #expect(state(scope: .new, brief: "heavy metal hits").canSubmit)
    }

    @Test func aYearOutsideTheRangeIsAnErrorOnItsOwnField() {
        #expect(state(scope: .new, brief: "x", eraFrom: "1800").eraFromError == .eraOutOfRange)
        #expect(state(scope: .new, brief: "x", eraTo: "3000").eraToError == .eraOutOfRange)
        #expect(state(scope: .new, brief: "x", eraFrom: "1980", eraTo: "1989").eraFromError == nil)
    }

    @Test func aPeriodThatRunsBackwardsIsAnErrorOnTheEnd() {
        let backwards = state(scope: .new, brief: "x", eraFrom: "1990", eraTo: "1980")
        #expect(backwards.eraFromError == nil)
        #expect(backwards.eraToError == .eraBackwards)
        #expect(!backwards.canSubmit)
    }

    @Test func aYearStillBeingTypedBlocksTheButtonWithoutShoutingAboutIt() {
        let typing = state(scope: .new, brief: "x", eraFrom: "19")
        #expect(typing.eraFromError == nil)
        #expect(!typing.canSubmit)
    }

    @Test func anEmptyPeriodIsNoBoundAtAll() {
        let none = state(scope: .new, brief: "x")
        #expect(none.canSubmit)
        #expect(none.putOnAirInput().eraFrom == nil)
        #expect(none.putOnAirInput().eraTo == nil)
    }

    @Test func aNewShowCarriesTheWordsAsItsNameTheYearsAsNumbersAndTheShapeAsChosen() {
        let input = state(
            scope: .new, brief: " heavy metal hits ", personaId: "p-2", eraFrom: "1980", eraTo: "1989", mode: .feature, onEnd: .stop, callins: true
        ).putOnAirInput()
        #expect(input.brief == "heavy metal hits")
        #expect(input.name == "heavy metal hits")
        #expect(input.personaId == "p-2")
        #expect(input.eraFrom == 1980)
        #expect(input.eraTo == 1989)
        #expect(input.mode == .feature)
        #expect(input.onEnd == .stop)
        #expect(input.callins == true)
    }

    @Test func phoneInsAreNamedOnlyWhenTheyWereAskedFor() {
        #expect(state(scope: .new, brief: "x", callins: false).putOnAirInput().callins == nil)
    }

    @Test func anUnchosenHostIsAbsent() {
        #expect(state(scope: .new, brief: "x").putOnAirInput().personaId == nil)
    }

    @Test func aBroadcastPlannedFromWordsNamesNoPlaylistAndNoChart() {
        let input = state(scope: .new, brief: "x").putOnAirInput()
        #expect(input.pluginId == nil)
        #expect(input.playlistId == nil)
        #expect(input.chartId == nil)
        #expect(input.chartOrder == nil)
    }
}
