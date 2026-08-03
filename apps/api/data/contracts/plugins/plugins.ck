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
