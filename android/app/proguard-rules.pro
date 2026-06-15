# React Native
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip

-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keep @com.facebook.common.internal.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}

# Native modules (JNI)
-keep class com.mangoqvac.** { *; }
-keep class com.facebook.react.bridge.** { *; }

# AsyncStorage
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-keep class org.asyncstorage.** { *; }

# llama.cpp / whisper.cpp JNI symbols
-keepclasseswithmembernames class * {
    native <methods>;
}

# Remove debug logs in release
-assumenosideeffects class android.util.Log {
    public static int d(...);
    public static int v(...);
    public static int i(...);
}
