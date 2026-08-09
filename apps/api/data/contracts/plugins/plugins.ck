options {
    keys: {
        area: plugins
    }
    services: {
        PluginsService: "#src/modules/plugins/plugins.service.js"
    }
    security: {
        # The floor for every operation in this file, cascading file -> route -> operation.
        # Configuring a plugin stores its credentials and reinitializes it, so the floor is the
        # operator gate rather than the read one, and it is the STRICT end on purpose: a route
        # added here without a security block inherits `platform.manage` and is over-gated, which
        # is a bug report. The other way round it would be a quiet hole.
        #
        # Three operations override it downward and say why at their own verb: the two summary
        # reads, and the OAuth callback the provider redirects a browser into.
        #
        # Object-scoped `plugin.configure` / `plugin.oauth` from core.perm would be the more
        # precise gate — they are what the `operator` grant was designed for — but they cannot be
        # named here yet. `requirePolicy` asserts with `{ session }` only, so a policy has no
        # plugin id to scope on. That needs a policy class first, not a contract change.
        policy: platform.manage
    }
}

operation /plugins: {
    get: { # Lists every plugin the host knows about
        name: List plugins
        service: PluginsService.listPlugins
        # A read, so it drops to the view floor. `PluginSummary` carries no configured values —
        # `secretsConfigured` is one boolean per secret field, never the secret.
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: array(PluginSummary)
            }
        }
    }
}

# Declared before /plugins/{id} so the literal segment is matched first.
operation /plugins/rescan: {
    post: { # Rescans the mounted plugin directory: registers new plugins, unloads removed ones
        name: Rescan plugins
        service: PluginsService.rescanPlugins
        response: {
            200: {
                application/json: array(PluginSummary)
            }
        }
    }
}

operation /plugins/{id}: {
    params: {
        id: string(min=1, max=200)
    }
    get: { # One plugin, including its stored non-secret configuration and last error
        name: Get plugin
        service: PluginsService.getPlugin
        # A read, so it drops to the view floor. `PluginDetail` adds the stored NON-secret config
        # and the last error; the secrets themselves are still only reported as booleans.
        security: {
            policy: platform.view
        }
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/config: {
    params: {
        id: string(min=1, max=200)
    }
    put: { # Validates against the plugin's own config schema, encrypts secrets, persists, and reinitializes
        name: Update plugin configuration
        service: PluginsService.updatePluginConfig
        request: {
            application/json: PluginConfigInput
        }
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/enable: {
    params: {
        id: string(min=1, max=200)
    }
    post: { # Enables a plugin without resubmitting its configuration
        name: Enable plugin
        service: PluginsService.enablePlugin
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/disable: {
    params: {
        id: string(min=1, max=200)
    }
    post: { # Disables a plugin and tears its instance down, keeping its configuration
        name: Disable plugin
        service: PluginsService.disablePlugin
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/reload: {
    params: {
        id: string(min=1, max=200)
    }
    post: { # Reapplies the plugin's stored configuration: disposes the running instance and initializes it again
        name: Reload plugin
        service: PluginsService.reloadPlugin
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/test: {
    params: {
        id: string(min=1, max=200)
    }
    post: { # Runs the plugin's own `testConnection()` through the invoker
        name: Test plugin connection
        service: PluginsService.testPlugin
        response: {
            200: {
                application/json: PluginTestResult
            }
        }
    }
}

operation /plugins/{id}/logs: {
    params: {
        id: string(min=1, max=200)
    }
    # Both log reads stay on the file's `platform.manage` floor rather than dropping to
    # `platform.view` with the other reads. Plugin log output is whatever the plugin chose to
    # write, including upstream error bodies, and a careless plugin can put a token in a line.
    # Treat it as operator-only until the log store can promise otherwise.
    get: { # Returns the plugin's buffered log lines at or above the current log level
        name: Get plugin logs
        service: PluginsService.getPluginLogs
        query: PluginLogQuery
        response: {
            200: {
                application/json: PluginLogPage
            }
        }
    }
}

operation /plugins/{id}/logs/download: {
    params: {
        id: string(min=1, max=200)
    }
    get: { # Streams the plugin's full retained log as a plain-text attachment
        name: Download plugin logs
        service: PluginsService.downloadPluginLogs
        response: {
            200: {
                headers: {
                    Content-Disposition?: string
                }
                text/plain: string
            }
        }
    }
}

operation /plugins/{id}/logs/level: {
    params: {
        id: string(min=1, max=200)
    }
    put: { # Sets the minimum severity the plugin's log store retains going forward
        name: Set plugin log level
        service: PluginsService.setPluginLogLevel
        request: {
            application/json: PluginLogLevelInput
        }
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/oauth/authorize: {
    params: {
        id: string(min=1, max=200)
    }
    get: { # Reports where to send the operator for the provider's consent screen
        name: Start plugin OAuth authorization
        service: PluginsService.startOAuthAuthorization
        response: {
            200: {
                # The URL is reported rather than redirected to. This route sits behind the
                # authenticated floor, and a browser navigating to it top-level sends no
                # Authorization header, so the console asks for the URL and redirects itself.
                application/json: PluginOAuthStart
            }
        }
    }
}

operation /plugins/{id}/oauth: {
    params: {
        id: string(min=1, max=200)
    }
    delete: { # Forgets the plugin's stored OAuth tokens and reinitializes it
        name: Disconnect plugin OAuth
        service: PluginsService.disconnectOAuth
        response: {
            200: {
                application/json: PluginDetail
            }
        }
    }
}

operation /plugins/{id}/oauth/callback: {
    params: {
        id: string(min=1, max=200)
    }
    get: { # Completes the flow. Anonymous: the provider redirects the browser here with no session of ours
        name: Complete plugin OAuth authorization
        service: PluginsService.completeOAuthCallback
        query: PluginOAuthCallbackQuery 
        security: none
        response: {
            200: {
                application/json: PluginOAuthResult
            }
        }
    }
}
