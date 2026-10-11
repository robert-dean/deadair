package com.maroonedsoftware.deadair.director

import com.maroonedsoftware.deadair.auth.Notice
import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.sdk.models.BreakUrgency
import com.maroonedsoftware.deadair.sdk.models.RequestStationBreakInput
import com.maroonedsoftware.deadair.sdk.models.RequestableBreakKind

/**
 * Asking the station to say something now, rather than when its format clock next calls for it.
 *
 * The station decides where the break goes and whether there is one at all, so this never reads the
 * running order to guess. Either answer is said: an accepted request because the break is not heard
 * until it has been written and spoken, which is longer than a press should go unanswered, and a
 * decline with the station's own reason, because "breaks are off" or "one went in a moment ago" is
 * what the operator needs to read. A decline is a 200 rather than a refusal, so it does not come
 * through [OperatorActions.run]'s failure path and has to be told here.
 *
 * The urgency is always `next`: between the record on air and the one after, once the break exists.
 * The phone offers no other, since `interrupt` talks over a record and the slower two are what the
 * station's own clock is already for.
 */
class BreakActions(private val actions: OperatorActions) {
    suspend fun request(kind: RequestableBreakKind): Boolean {
        val answer = actions.run { it.director.requestABreak(RequestStationBreakInput(kind = kind, urgency = BreakUrgency.NEXT)) } ?: return false
        actions.tell(if (answer.accepted) Notice.BreakAsked(kind) else Notice.BreakDeclined(answer.reason))
        return answer.accepted
    }
}
