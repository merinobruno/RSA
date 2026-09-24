package com.rsa.telemetry.util

import org.junit.Assert.assertEquals
import org.junit.Test

class VersionCheckTest {

    @Test
    fun `the same version on both sides is up to date`() {
        assertEquals(VersionStatus.UpToDate, VersionCheck.compare("1.1.0", "1.1.0"))
    }

    @Test
    fun `a server ahead of the app means the app must be updated`() {
        assertEquals(VersionStatus.UpdateRequired("1.2.0"), VersionCheck.compare("1.1.0", "1.2.0"))
        assertEquals(VersionStatus.UpdateRequired("2.0.0"), VersionCheck.compare("1.9.9", "2.0.0"))
        assertEquals(VersionStatus.UpdateRequired("1.1.1"), VersionCheck.compare("1.1.0", "1.1.1"))
    }

    @Test
    fun `an app ahead of the server is reported as the server being behind`() {
        assertEquals(VersionStatus.ServerBehind("1.1.0"), VersionCheck.compare("1.2.0", "1.1.0"))
    }

    @Test
    fun `parts compare as numbers, not as text`() {
        assertEquals(VersionStatus.UpdateRequired("1.10.0"), VersionCheck.compare("1.9.0", "1.10.0"))
    }

    @Test
    fun `a missing or malformed server version is unknown, never a verdict`() {
        assertEquals(VersionStatus.Unknown, VersionCheck.compare("1.1.0", null))
        assertEquals(VersionStatus.Unknown, VersionCheck.compare("1.1.0", "1.1"))
        assertEquals(VersionStatus.Unknown, VersionCheck.compare("1.1.0", "1.1.0-beta"))
        assertEquals(VersionStatus.Unknown, VersionCheck.compare("1.1.0", ""))
    }
}
