package com.kvak

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class WhisperModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val NAME = "WhisperModule"
        const val TAG = "Kvak"
    }

    override fun getName() = NAME

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        try {
            val ok = WhisperBridge.loadModel(modelPath)
            if (ok) promise.resolve(true) else promise.reject("LOAD_ERROR", "Failed to load whisper model")
        } catch (e: Exception) {
            promise.reject("LOAD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun free(promise: Promise) {
        try { WhisperBridge.free(); promise.resolve(true) }
        catch (e: Exception) { promise.reject("FREE_ERROR", e.message) }
    }

    @ReactMethod
    fun startRecording(promise: Promise) {
        try {
            promise.resolve(true)
            WhisperBridge.recordAndTranscribe(
                maxDurationMs = 30000,
                silenceThresholdMs = 1500,
                onStatus = { status ->
                    sendEvent("whisperStatus", status)
                },
                onComplete = { text ->
                    sendEvent("whisperResult", text)
                }
            )
        } catch (e: Exception) {
            promise.reject("RECORD_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        WhisperBridge.stopRecording()
        promise.resolve(true)
    }

    @ReactMethod
    fun isRecording(promise: Promise) {
        promise.resolve(WhisperBridge.isRecording())
    }

    private fun sendEvent(name: String, value: String) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(name, value)
        } catch (_: Exception) {}
    }
}
