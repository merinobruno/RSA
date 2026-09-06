# Release minification is disabled by default (see app/build.gradle.kts) to avoid
# shipping an unverified R8 configuration on a device that is hard to debug in the field
# (a general-aviation cockpit, not a desk). If you enable isMinifyEnabled for a release
# build, verify these rules against the exact library versions in app/build.gradle.kts:
#
# - kotlinx.serialization needs its serializers kept:
#   -keepattributes *Annotation*, InnerClasses
#   -dontnote kotlinx.serialization.AnnotationsKt
#   -keepclassmembers class com.rsa.telemetry.**$$serializer { *; }
#   -keepclassmembers class com.rsa.telemetry.** { *** Companion; }
#   -keepclasseswithmembers class com.rsa.telemetry.** { kotlinx.serialization.KSerializer serializer(...); }
#
# - Room's generated implementations and entities must not be renamed:
#   -keep class * extends androidx.room.RoomDatabase
#   -keep @androidx.room.Entity class *
#
# - WorkManager's CoroutineWorker subclasses are instantiated by reflection:
#   -keep class com.rsa.telemetry.work.** { *; }
