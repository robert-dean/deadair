package com.maroonedsoftware.deadair

import android.app.Application

/**
 * The application object, which is where the app's few long-lived objects will hang.
 *
 * There is no dependency-injection framework here and there is not meant to be: a settings store,
 * an HTTP client and a repository are four objects, and a code generator to wire four objects is
 * more moving parts than the thing it wires.
 */
class DeadairApp : Application()
