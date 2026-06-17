package com.kvak

import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

object LlamaBridge {
    private const val TAG = "Kvak"

    init {
        System.loadLibrary("kvak_llama")
    }

    external fun nativeLoadModel(modelPath: String): Boolean
    external fun nativeCompletion(prompt: String, nPredict: Int): String
    external fun nativeStreamCompletion(prompt: String, nPredict: Int): String
    external fun nativeStopGeneration()
    external fun nativeFreeModel()

    // Embed support for RAG (on-device llama.cpp embeddings)
    external fun nativeLoadEmbedModel(modelPath: String): Boolean
    external fun nativeGetEmbeddings(text: String): FloatArray
    external fun nativeFreeEmbedModel()

    // Callbacks from C++ during streaming — called from JNI thread
    var streamTokenCallback: ((String) -> Unit)? = null
    var streamDoneCallback: (() -> Unit)? = null

    fun onStreamToken(token: String) { streamTokenCallback?.invoke(token) }
    fun onStreamDone() { streamDoneCallback?.invoke() }

    fun loadModel(path: String): Boolean {
        Log.i(TAG, "LlamaBridge.loadModel: $path")
        return nativeLoadModel(path)
    }

    fun complete(prompt: String, maxTokens: Int = 256): String {
        return nativeCompletion(prompt, maxTokens)
    }

    fun stopGeneration() {
        nativeStopGeneration()
    }

    fun free() {
        nativeFreeModel()
    }

    fun loadEmbedModel(path: String): Boolean {
        Log.i(TAG, "LlamaBridge.loadEmbedModel: $path")
        return nativeLoadEmbedModel(path)
    }

    fun getEmbeddings(text: String): FloatArray {
        return nativeGetEmbeddings(text)
    }

    fun freeEmbed() {
        nativeFreeEmbedModel()
    }

    fun writeFile(path: String, data: ByteArray): Boolean {
        try {
            val file = File(path)
            file.parentFile?.mkdirs()
            FileOutputStream(file).use { it.write(data) }
            return true
        } catch (e: Exception) {
            Log.e(TAG, "writeFile error: ${e.message}")
            return false
        }
    }

    fun fileExists(path: String): Boolean = File(path).exists()
    fun fileSize(path: String): Long = File(path).length()

    fun deleteFile(path: String): Boolean {
        return try { File(path).delete() } catch (e: Exception) { false }
    }

    fun downloadFile(
        urlStr: String,
        destPath: String,
        onProgress: (downloaded: Long, total: Long, pct: Int) -> Unit,
        onComplete: (success: Boolean, error: String?) -> Unit
    ) {
        thread(name = "model-download") {
            try {
                val file = File(destPath)
                file.parentFile?.mkdirs()
                val existingLen = if (file.exists()) file.length() else 0L
                val url = URL(urlStr)
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 30000
                conn.readTimeout = 60000
                if (existingLen > 0) conn.setRequestProperty("Range", "bytes=$existingLen-")
                conn.connect()
                val responseCode = conn.responseCode
                val totalStr = conn.getHeaderField("Content-Length")
                val serverTotal = totalStr?.toLongOrNull() ?: -1L
                val total = if (responseCode == 206 && existingLen > 0) existingLen + serverTotal
                            else if (responseCode == 200) serverTotal else -1L
                val append = responseCode == 206 && existingLen > 0
                val fos = FileOutputStream(file, append)
                val input = conn.inputStream
                val buf = ByteArray(8192)
                var downloaded = existingLen
                var lastPct = -1
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    fos.write(buf, 0, n)
                    downloaded += n
                    val pct = if (total > 0) (downloaded * 100 / total).toInt()
                              else ((downloaded / 1048576) % 100).toInt()
                    if (pct != lastPct) { lastPct = pct; onProgress(downloaded, total, pct) }
                }
                fos.flush(); fos.close(); input.close(); conn.disconnect()
                Log.i(TAG, "Download complete: $destPath ($downloaded bytes)")
                onComplete(true, null)
            } catch (e: Exception) {
                Log.e(TAG, "Download failed: ${e.message}")
                onComplete(false, e.message)
            }
        }
    }
}
