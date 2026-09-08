package com.maroonedsoftware.deadair.scripts

import com.maroonedsoftware.deadair.auth.OperatorActions
import com.maroonedsoftware.deadair.sdk.models.ScriptAttempt
import com.maroonedsoftware.deadair.sdk.models.ScriptRating
import com.maroonedsoftware.deadair.sdk.models.ScriptRatingInput
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** The operator's opinion of something the station said. Nothing acts on it yet; it is kept. */
@OptIn(ExperimentalUuidApi::class)
class ScriptActions(private val actions: OperatorActions) {
    suspend fun rate(attemptId: String, rating: ScriptRating): ScriptAttempt? =
        actions.run { it.render.rateScript(Uuid.parse(attemptId), ScriptRatingInput(rating = rating)) }
}
