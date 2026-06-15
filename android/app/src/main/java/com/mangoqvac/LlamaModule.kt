package com.mangoqvac

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.util.Log
import kotlin.concurrent.thread
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule

@ReactModule(name = LlamaModule.NAME)
class LlamaModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val NAME = "LlamaModule"
        const val TAG = "MangoQVAC"
    }

    override fun getName() = NAME

    @ReactMethod
    fun getDeviceInfo(promise: Promise) {
        try {
            val actManager = reactApplicationContext.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val memInfo = ActivityManager.MemoryInfo()
            actManager.getMemoryInfo(memInfo)
            val filesDir = reactApplicationContext.filesDir
            val freeBytes = filesDir.usableSpace
            val totalBytes = filesDir.totalSpace
            val maxModelBytes = (memInfo.totalMem * 0.6).toLong()
            val result = Arguments.createMap().apply {
                putDouble("totalRamMB", memInfo.totalMem / 1048576.0)
                putDouble("availRamMB", memInfo.availMem / 1048576.0)
                putDouble("freeStorageGB", freeBytes / 1073741824.0)
                putDouble("totalStorageGB", totalBytes / 1073741824.0)
                putDouble("maxModelMB", maxModelBytes / 1048576.0)
                putString("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                putString("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
                putInt("cores", Runtime.getRuntime().availableProcessors())
            }
            promise.resolve(result)
        } catch (e: Exception) { promise.reject("DEVICE_INFO_ERROR", e.message) }
    }

    @ReactMethod
    fun loadModel(modelPath: String, promise: Promise) {
        try {
            val ok = LlamaBridge.loadModel(modelPath)
            if (ok) promise.resolve(true) else promise.reject("LOAD_ERROR", "Failed to load model")
        } catch (e: Exception) { promise.reject("LOAD_ERROR", e.message) }
    }

    @ReactMethod
    fun complete(prompt: String, maxTokens: Double, promise: Promise) {
        try {
            val result = LlamaBridge.complete(prompt, maxTokens.toInt())
            promise.resolve(result)
        } catch (e: Exception) { promise.reject("COMPLETION_ERROR", e.message) }
    }

    @ReactMethod
    fun streamCompletion(prompt: String, maxTokens: Double, promise: Promise) {
        try {
            // Wire up streaming callbacks to emit JS events
            LlamaBridge.streamTokenCallback = { token ->
                try {
                    reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("llamaToken", token)
                } catch (_: Exception) {}
            }
            LlamaBridge.streamDoneCallback = {
                try {
                    reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("llamaStreamDone", true)
                } catch (_: Exception) {}
            }

            // Run streaming on a background thread
            val maxTok = maxTokens.toInt()
            thread(name = "llama-stream") {
                try {
                    LlamaBridge.nativeStreamCompletion(prompt, maxTok)
                } catch (e: Exception) {
                    try {
                        reactApplicationContext
                            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit("llamaStreamError", e.message)
                    } catch (_: Exception) {}
                }
            }

            promise.resolve(true)
        } catch (e: Exception) { promise.reject("STREAM_ERROR", e.message) }
    }

    @ReactMethod
    fun stopGeneration(promise: Promise) {
        LlamaBridge.stopGeneration()
        promise.resolve(true)
    }

    @ReactMethod
    fun free(promise: Promise) {
        try { LlamaBridge.free(); promise.resolve(true) }
        catch (e: Exception) { promise.reject("FREE_ERROR", e.message) }
    }

    @ReactMethod
    fun modelDir(promise: Promise) { promise.resolve(reactApplicationContext.filesDir.absolutePath) }

    @ReactMethod
    fun fileExists(path: String, promise: Promise) { promise.resolve(LlamaBridge.fileExists(path)) }

    @ReactMethod
    fun fileSize(path: String, promise: Promise) { promise.resolve(LlamaBridge.fileSize(path)) }

    @ReactMethod
    fun deleteFile(path: String, promise: Promise) { promise.resolve(LlamaBridge.deleteFile(path)) }

    @ReactMethod
    fun listModels(promise: Promise) {
        try {
            val dir = reactApplicationContext.filesDir
            val files = dir.listFiles()?.filter { it.name.endsWith(".gguf") }?.map { it.name } ?: emptyList()
            val arr = Arguments.createArray()
            files.forEach { arr.pushString(it) }
            promise.resolve(arr)
        } catch (e: Exception) { promise.reject("LIST_ERROR", e.message) }
    }

    @ReactMethod
    fun downloadModel(url: String, filename: String, promise: Promise) {
        val destPath = "${reactApplicationContext.filesDir.absolutePath}/$filename"
        promise.resolve(true)
        LlamaBridge.downloadFile(
            url, destPath,
            onProgress = { downloaded, total, pct ->
                try {
                    reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("downloadProgress", Arguments.createMap().apply {
                            putString("filename", filename)
                            putDouble("downloaded", downloaded.toDouble())
                            putDouble("total", total.toDouble())
                            putInt("pct", pct)
                        })
                } catch (_: Exception) {}
            },
            onComplete = { success, error ->
                try {
                    reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit("downloadComplete", Arguments.createMap().apply {
                            putString("filename", filename)
                            putBoolean("success", success)
                            putString("error", error)
                        })
                } catch (_: Exception) {}
            }
        )
    }
}
