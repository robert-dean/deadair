options {
    keys: {
        area: plugins
    }
    services: {
        PluginsService: "#src/modules/plugins/plugins.service.js"
    }
}

operation /plugins: {
    get: { # Lists every plugin the host knows about, optionally narrowed to one kind
        name: List plugins
        service: PluginsService.listPlugins
        security: {
            policy: none
        }
        query: PluginListQuery
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
        security: {
            policy: platform.manage
        }
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
        security: {
            policy: none
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
    get: { # Returns the plugin's buffered log lines at or above the current log level
        name: Get plugin logs
        service: PluginsService.getPluginLogs
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
        security: {
            policy: none
        }
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
