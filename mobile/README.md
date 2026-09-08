# RSA Telemetry (mobile)

Native Android (Kotlin) app that runs on a phone riding along in a general-aviation aircraft.
While tracking is active, it reads GPS location + linear acceleration + battery level **once a
second** and uploads them to a backend server as JSON, over HTTPS, **every 30 seconds**. It is
built to survive intermittent cellular coverage: readings are queued locally first and uploaded
opportunistically, so a signal gap never loses data.

Reading, queueing and uploading are three different rates, deliberately:

| | Rate | Why |
|---|---|---|
| Read a sensor | every second | At 200 km/h a 30-second sample is a point every 1.7 km, which cannot show a turn or a descent. |
| Queue a packet | every second while moving, every 30 s while stationary | A parked phone would otherwise record 28,800 identical positions in eight hours. |
| Upload | every 30 seconds | The cost of an upload is establishing the connection, paid per request, not per packet. |

The backend is a separate Node.js/TypeScript project (`../server` in this repository) built in
parallel; this app only needs to match its `POST /v1/telemetry` contract, documented below under
[Packet contract](#packet-contract).

## Building

### Option A: Android Studio (recommended)

1. Open the `mobile/` folder as a project in a recent Android Studio (Koala/2024.1 or newer).
2. Let Gradle sync.
3. Build > Make Project, or run the `app` configuration on a device/emulator.

**Set the Gradle JDK to 17 or 21.** The wrapper pins Gradle 8.7, which supports JDK 21 at the
newest -- JDK 22 support first landed in Gradle 8.8. A recent Android Studio bundles a much newer
JBR (25 at the time of writing), and the build fails outright on it. Settings > Build, Execution,
Deployment > Build Tools > Gradle > **Gradle JDK** > Download JDK > 21.

### Option B: command line

```sh
./gradlew assembleDebug   # Linux/macOS
gradlew.bat assembleDebug # Windows
./gradlew test            # JVM unit tests (no emulator needed)
```

Requires a JDK 17 or 21 (see the note above) and the Android SDK (`compileSdk 34`) available,
either via `ANDROID_HOME`/`local.properties`, or an Android Studio installation on the same
machine. If `java` is not on your PATH, point `JAVA_HOME` at the JDK, e.g. the one Android Studio
downloaded under `~/.jdks/`.

## Project layout

```
mobile/
  app/src/main/java/com/rsa/telemetry/
    MainActivity.kt              start/stop tracking, live status
    SettingsActivity.kt          device_id / api_key / server URL form
    MobileApp.kt, AppContainer.kt  application-level wiring (manual DI, no framework)
    capture/                     turning sensors into a packet
      LocationProvider.kt          FusedLocationProviderClient wrapper
      AccelerationSensorReader.kt  TYPE_LINEAR_ACCELERATION listener
      BatteryReader.kt             BatteryManager wrapper
      TelemetryReading.kt          raw sensor snapshot (plain data)
      PacketFactory.kt             TelemetryReading -> TelemetryPacket (plain, unit tested)
      TelemetryPacket.kt           wire-format DTO (kotlinx.serialization)
    queue/
      PacketStatus.kt               PENDING / SENT
      QueuePolicy.kt                trim bounds + retry decisions (plain, unit tested)
    data/
      PacketEntity.kt               Room row + packet <-> entity mapping
      PacketDao.kt                  insert / fetch-pending / mark-sent / trim
      AppDatabase.kt                Room database singleton
      SettingsRepository.kt         SharedPreferences-backed settings
    network/
      TelemetryApiClient.kt         OkHttp POST to /v1/telemetry
      TelemetryUploader.kt          batches the queue against the API client
      ConnectivityChecker.kt        "do we currently have a network?"
      UploadOutcome.kt              result types for the above
    service/
      TelemetryForegroundService.kt  the 1 Hz capture loop and the 30s upload loop, foreground + notification
      NotificationHelper.kt         notification channel + persistent notification
    work/
      RetryUploadWorker.kt           WorkManager backstop flush
  app/src/test/java/...            JVM unit tests (see Testing below)
```

## Packet contract

One packet is built and queued per reading that survives `QueuePolicy.shouldEnqueue` -- every
second while the aircraft is moving, once every 30 seconds while it is not:

```json
{
  "packet_id": "uuid-v4",
  "device_id": "uuid",
  "captured_at": "2026-09-05T14:32:01.000Z",
  "lat": -34.6037,
  "lon": -58.3816,
  "altitude_m": 1200.5,
  "gps_accuracy_m": 8.2,
  "speed_mps": 42.3,
  "heading_deg": 187.4,
  "acceleration": { "x": 0.12, "y": -0.03, "z": 9.81 },
  "battery_pct": 76
}
```

Sent as `POST /v1/telemetry` with header `Authorization: Bearer <api_key>` and a JSON **array**
body (even a single-packet flush still POSTs `[{...}]`). Field sources:

- `lat`/`lon`/`altitude_m`/`gps_accuracy_m`/`speed_mps`/`heading_deg` come directly from a
  `Location` returned by `FusedLocationProviderClient` (`getLatitude`/`getLongitude`/`getAltitude`/
  `getAccuracy`/`getSpeed`/`getBearing`) -- nothing is hand-calculated.
- `acceleration` comes from the `TYPE_LINEAR_ACCELERATION` sensor (gravity already removed by the
  platform), not the raw accelerometer.
- `battery_pct` comes from `BatteryManager`.
- `packet_id` is a fresh UUID v4 minted once, at capture time, by `PacketFactory` -- it is stored in
  the queue row and is the value resent on every retry (retries never call `PacketFactory` again;
  they just re-read the stored row). The server uses it as the dedupe key, which is also why a
  duplicate send from an overlapping retry trigger is harmless rather than a bug (see
  [Upload strategy](#upload-strategy)).
- `device_id` is never auto-generated; it is typed in once on the Settings screen and must match a
  device already registered on the backend.
- If no GPS fix is available yet (cold start, indoors, brief loss of satellites), that capture tick
  is skipped entirely rather than sending a zeroed/garbage location -- a gap in the track is honest,
  a fake point is not.

## Configuring the app

Open **Settings** from the main screen and fill in, once, before flying:

- **Device ID**: the UUID assigned to this device when it was registered on the backend.
- **API key**: the bearer token the backend expects in `Authorization: Bearer <api_key>`.
- **Server base URL**: e.g. `https://telemetry.example.com` (no trailing slash needed; the app
  appends `/v1/telemetry` itself). Must be `https://` -- the app enforces this in the form and never
  sends the queue over plaintext HTTP.

These are stored in a private `SharedPreferences` file (`android:allowBackup="false"`, and Android
12+'s scoped backup rules also explicitly exclude it -- see `res/xml/data_extraction_rules.xml`),
so the API key never leaves the device via cloud backup.

## Permissions

| Permission | Why |
|---|---|
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | GPS fix for every packet. |
| `ACCESS_BACKGROUND_LOCATION` | Captures must continue with the screen off / app backgrounded. |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` | The capture loop runs in a foreground service; API 34+ requires declaring its specific type. |
| `POST_NOTIFICATIONS` | Android 13+ requires runtime consent to show the persistent "Tracking active" notification the foreground service depends on. |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Upload packets; check connectivity before attempting it. |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Best-effort battery-optimization exemption request (see caveat below). |
| `RECEIVE_BOOT_COMPLETED` | Lets the WorkManager periodic retry job survive a reboot mid-flight-day (declared by the WorkManager library itself; listed here for completeness). |

All runtime-dangerous permissions (location, notifications) are requested from `MainActivity`
before the service is started, in sequence: fine location, then background location, then (API
33+) notifications. None of these are hard-blocking except fine location itself -- if background
location or notifications are denied, the app still starts the service rather than refusing
outright, on the theory that degraded tracking beats no tracking, but the operator is told via a
toast either way.

## Battery optimization caveat (read this before flying)

**This is a known, unsolvable-in-software risk, not a bug.** Aggressive OEM battery managers
(Xiaomi/MIUI, Huawei/EMUI, Oppo/ColorOS, some Samsung configurations, etc.) can and do kill
background services and foreground services alike, regardless of what the standard Android APIs
say, as part of their own custom battery-saving heuristics that sit outside AOSP's documented
behavior.

The app requests the standard `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` exemption (button on the main
screen: "Disable battery optimization for this app"). This is the correct, Google-documented API
for this and it works reliably on stock/near-stock Android. It does **not** reliably work around
OEM-specific battery managers layered on top.

**Before a flight, on the phone that will fly:**

1. Open the app, tap **"Disable battery optimization for this app"**, and confirm.
2. On Xiaomi/MIUI: Settings > Apps > Manage apps > RSA Telemetry > Battery saver > **No restrictions**,
   and separately enable **Autostart** for the app.
3. On Huawei/EMUI: Settings > Battery > App launch > RSA Telemetry > set to **Manage manually** and
   enable all three toggles (auto-launch, secondary launch, run in background).
4. On other OEMs, look for an equivalent "protected apps" / "auto-start manager" / "battery saver
   per-app" screen and allowlist RSA Telemetry.
5. Do a short ground test (start tracking, lock the screen, wait a few minutes, unlock and confirm
   the queued-packet count went up) before trusting it in the air.

If a given OEM kills the service anyway, there is no further software fix available from within the
app -- this is intentionally not over-engineered around (e.g. with a second watchdog process, alarm-
based self-resurrection tricks, etc.), because those techniques are themselves exactly what modern
OEM battery managers are tuned to detect and kill harder. The honest fix is the manual allowlisting
above.

## Local queue

Room/SQLite (`PacketEntity` + `PacketDao`). Every captured packet is inserted as `PENDING`
immediately, before any network attempt. `markSent` deletes rows outright rather than flagging and
purging separately later: the server dedupes by `packet_id`, so nothing is lost by not keeping a
local record of what already succeeded, and deleting immediately keeps on-disk usage as small as
possible on a storage-constrained phone.

Two independent trim bounds keep a long outage from growing the queue without limit:

- **Age**: rows older than **24 hours** are dropped (`QueuePolicy.MAX_PENDING_AGE_MILLIS`). At that
  point the flight this data belongs to is long over.
- **Row count**: capped at **86,400 rows** (`QueuePolicy.MAX_PENDING_ROWS`), a full day at 1 Hz --
  a second, independent bound in case a clock jump ever makes the age-based trim unreliable. It had
  to grow with the capture rate: the previous cap of 3,000 rows held 25 hours at the old 30-second
  cadence and would hold **50 minutes** at 1 Hz, against a 62-minute outage actually recorded in
  the field.

Both are plain constants/functions in `QueuePolicy.kt` (no Room/Android import), so the thresholds
themselves are unit tested without a database. Rejected rows (below) are trimmed on the same age
cutoff.

## Rejected packets

A `2xx` from the server is not a blanket receipt. The server validates each packet independently and
names the ones it refused in `rejected_packets`. Marking a whole batch as delivered because the HTTP
call succeeded would silently erase flight data while the pilot's screen still read "healthy" -- so
the client reads that list (`RejectionResolver`, pure Kotlin and unit tested) and splits the batch:

- **Stored packets** are deleted from the queue, as before.
- **Refused packets** are flagged `REJECTED` with the server's reason (`PacketEntity.rejectionReason`,
  added in schema version 2 via a real migration -- the queue can hold a day of un-uploaded flight
  data at upgrade time, so destructive migration is not an option).

Rejected packets are **never retried**: a packet refused for failing validation would be refused
identically forever. They are kept only so the loss is visible -- the count and the latest reason
appear on the main screen and in the notification, and only ever appear when non-zero, so a flight
losing data never looks the same as a healthy one.

A rejection the client cannot match to a local row (neither a known `packet_id` nor a usable index)
is still counted, so the number shown never under-reports; it just has no row to flag.

## Upload strategy

An upload attempt is triggered from two independent places, matching the brief's requirement to
flush both right after a capture and to catch up after an outage:

1. **Every 30 seconds**, an upload loop in `TelemetryForegroundService` calls
   `TelemetryUploader.flushPending()` directly, in-process. This is its own loop rather than part of
   the capture tick: an upload measured at ~10 s on the weak phone would otherwise have stalled ten
   captures, which is what made 1 Hz unachievable there.
2. **A `WorkManager` periodic job** (`RetryUploadWorker`, every 15 minutes -- WorkManager's documented
   minimum periodic interval, so more frequent isn't possible with it) with a `NetworkType.CONNECTED`
   constraint. WorkManager re-evaluates that constraint continuously, so a run that could not fire
   because there was no signal fires as soon as connectivity returns, not just on the next 15-minute
   tick. This is the backstop that still works even if the foreground service itself has been killed
   by an OEM battery manager.
3. As a faster-than-15-minutes complement to (2) while the service *is* alive, it also registers its
   own `ConnectivityManager.NetworkCallback` and flushes immediately on `onAvailable`, plus fires one
   expedited one-time `WorkManager` request for good measure.

**Why WorkManager for the periodic/reconnect path, and not a hand-rolled `AlarmManager` +
`BroadcastReceiver` scheme**: WorkManager already solves exactly this problem (durable,
constraint-aware, survives process death and reboot, backs off retries) with a well-tested library
instead of a bespoke implementation that would have to reinvent all of that -- reliability here
matters more than shaving the (small) library footprint, and it composes cleanly with the
in-process flush instead of replacing it.

Every flush call funnels through a single in-process `Mutex` so the two triggers never run
concurrently against the same rows -- but this is an efficiency measure, not a correctness
requirement: since the server dedupes by `packet_id`, even a genuinely concurrent duplicate send
from two processes would just waste bandwidth, never corrupt data or double-count a reading.

A flush walks the pending queue in bounded batches of 200 (`QueuePolicy.UPLOAD_BATCH_SIZE`) so a
POST body stays reasonable in size even after a very long outage leaves thousands of rows queued;
it keeps issuing batches until the queue is empty, the network drops, or the server rejects one.

## Testing

`PacketFactory` (reading -> wire packet), `QueuePolicy` (trim bounds + retry/upload decisions),
`Iso8601` (timestamp formatting), the `TelemetryPacket` <-> `PacketEntity` mapping, and the
kotlinx.serialization wire shape are all plain JVM logic with no Android framework dependency, and
are covered by JUnit tests under `app/src/test/java`:

```sh
./gradlew test
```

**What is intentionally not covered here, and needs a real device/emulator:** actual Room DAO
behavior against a real SQLite file (`androidx.room:room-testing` is already wired into the
`androidTest` source set for this), and -- more importantly -- whether the foreground service
actually survives screen-off, Doze, and app-switching across different OEM skins. That last one
cannot be meaningfully faked in any unit or instrumented test; it needs field testing on the actual
phone(s) that will fly, per the [battery optimization caveat](#battery-optimization-caveat-read-this-before-flying)
above. No instrumented test results are claimed or fabricated here -- there simply are none yet.

## What is and is not verified

**Verified on a real toolchain** (Gradle 8.7 on JDK 21, AGP 8.5.2, Android SDK 34):

- `./gradlew test` - **29 JVM unit tests pass, 0 failures**, across `PacketFactory`, `QueuePolicy`,
  `Iso8601`, the `PacketEntity` mapping, the serialization wire shape, and `RejectionResolver`.
- `./gradlew assembleDebug` - builds a debug APK, **no compiler warnings**.

**Not verified, and not verifiable without hardware:**

- Everything that needs a real device: GPS and accelerometer readings, the foreground service
  surviving with the screen off, and above all whether an OEM battery manager kills the service
  mid-flight. There are no instrumented tests yet, and none are claimed.
- Room DAO behavior against a real SQLite database (the queue logic that *is* pure Kotlin is
  covered; the queries themselves are not).
- Before trusting this on a real flight, install the APK on the actual phone you intend to fly with
  and do the ground test described in the battery optimization section.
