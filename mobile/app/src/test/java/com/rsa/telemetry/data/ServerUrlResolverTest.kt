package com.rsa.telemetry.data

import org.junit.Assert.assertEquals
import org.junit.Test

class ServerUrlResolverTest {

    private val default = "https://rsa-telemetry-server-production.up.railway.app"

    @Test
    fun `a fresh install gets the default server`() {
        assertEquals(default, ServerUrlResolver.resolve(stored = null, default = default))
        assertEquals(default, ServerUrlResolver.resolve(stored = "  ", default = default))
    }

    @Test
    fun `a url saved against the retired Render host moves to the default`() {
        assertEquals(
            default,
            ServerUrlResolver.resolve(stored = "https://rsa-telemetry-server.onrender.com", default = default)
        )
    }

    @Test
    fun `a url the operator chose themselves is kept`() {
        val custom = "https://telemetry.example.com"
        assertEquals(custom, ServerUrlResolver.resolve(stored = custom, default = default))
    }

    @Test
    fun `a host that only contains the retired name is not mistaken for it`() {
        val custom = "https://onrender.com.example.com"
        assertEquals(custom, ServerUrlResolver.resolve(stored = custom, default = default))
    }
}
