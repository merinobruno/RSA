plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

android {
    namespace = "com.rsa.telemetry"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.rsa.telemetry"
        // minSdk 26 (Android 8.0) is chosen deliberately for two reasons documented in the README:
        // 1) java.time.Instant is natively available without a desugaring dependency, which we
        //    rely on to format the captured_at ISO-8601 UTC timestamp exactly.
        // 2) Adaptive launcher icons (mipmap-anydpi-v26) need no legacy raster fallback.
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = false
            isReturnDefaultValues = true
        }
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // --- AndroidX core / UI ---
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-service:2.8.4")
    implementation("androidx.activity:activity-ktx:1.9.1")

    // --- Location (fused provider is required by the packet contract) ---
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // --- Local queue (Room) ---
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // --- Background retry scheduling ---
    implementation("androidx.work:work-runtime-ktx:2.9.0")

    // --- Networking: plain OkHttp + kotlinx.serialization instead of Retrofit + Moshi.
    // There is exactly one endpoint (POST /v1/telemetry) so Retrofit's interface-proxy
    // generation buys us nothing; a single OkHttp call keeps the method count and runtime
    // footprint lower, which matters on the low-end phones this app targets. kotlinx.serialization
    // uses a compile-time Kotlin compiler plugin (no reflection), same performance rationale
    // as Moshi codegen would have given, with one fewer dependency to manage.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")

    // --- Coroutines ---
    // Note: no kotlinx-coroutines-play-services dependency -- LocationProvider wraps
    // FusedLocationProviderClient with a hand-written suspendCancellableCoroutine instead of the
    // library's Task.await() so that cancelling the coroutine also cancels the underlying
    // CancellationTokenSource (a plain .await() would leave that in-flight request running).
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // --- Unit tests (plain JVM, no emulator required) ---
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")

    // --- Instrumented tests (need a device/emulator; see README for scope/limits) ---
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
}
