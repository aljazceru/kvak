package com.kvak

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule

// PDF and EPUB text extraction for RAG (on-device, no cloud)
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import org.jsoup.Jsoup

@ReactModule(name = LlamaModule.NAME)
class LlamaModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val NAME = "LlamaModule"
        const val TAG = "Kvak"
        private const val PICK_RAG_DOC = 0xBEEF + 1
        private const val PICK_RAG_DIR = 0xBEEF + 2
        internal const val PERSISTABLE_URI_FLAGS: Int =
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }

    private var pickDocPromise: Promise? = null
    private var pickDirPromise: Promise? = null
    private var pdfBoxInitialized = false

    private fun ensurePdfBoxInitialized() {
        if (!pdfBoxInitialized) {
            try {
                PDFBoxResourceLoader.init(reactApplicationContext)
                pdfBoxInitialized = true
            } catch (e: Exception) {
                Log.w(TAG, "PDFBox init failed (PDF extraction may not work): ${e.message}")
            }
        }
    }

    private fun readSafTextInternal(resolver: android.content.ContentResolver, uri: Uri): String {
        resolver.openInputStream(uri)?.use { input ->
            return BufferedReader(InputStreamReader(input)).use { it.readText() }
        }
        return ""
    }

    private fun extractPdfText(resolver: android.content.ContentResolver, uri: Uri): String {
        ensurePdfBoxInitialized()
        resolver.openInputStream(uri)?.use { input ->
            PDDocument.load(input).use { doc ->
                val stripper = PDFTextStripper()
                return stripper.getText(doc).trim()
            }
        }
        return ""
    }

    /**
     * Simple EPUB text extractor.
     * Follows the spine for document order (best effort with regex OPF parse + Jsoup for content).
     * EPUBs are ZIPs containing XHTML; this pulls readable body text.
     */
    private fun extractEpubText(resolver: android.content.ContentResolver, uri: Uri): String {
        val sb = StringBuilder()
        try {
            resolver.openInputStream(uri)?.use { stream ->
                ZipInputStream(BufferedInputStream(stream)).use { zip ->
                    val entries = mutableMapOf<String, ByteArray>()
                    var ze: ZipEntry? = zip.nextEntry
                    while (ze != null) {
                        if (!ze.isDirectory) {
                            entries[ze.name] = zip.readBytes()
                        }
                        zip.closeEntry()
                        ze = zip.nextEntry
                    }

                    // Find OPF via container.xml
                    val containerBytes = entries["META-INF/container.xml"]
                        ?: entries.values.firstOrNull { String(it, Charsets.UTF_8).contains("container", true) }
                    if (containerBytes == null) return@use
                    val containerStr = String(containerBytes, Charsets.UTF_8)
                    val rootFile = Regex("full-path=\"([^\"]+)\"").find(containerStr)?.groupValues?.getOrNull(1) ?: "content.opf"

                    val opfBytes = entries[rootFile]
                        ?: entries.values.firstOrNull { String(it, Charsets.UTF_8).contains("<package", true) }
                        ?: return@use
                    val opf = String(opfBytes, Charsets.UTF_8)

                    // Manifest: id -> href
                    val manifest = mutableMapOf<String, String>()
                    Regex("<item[^>]+id=\"([^\"]+)\"[^>]+href=\"([^\"]+)\"[^>]*/?>").findAll(opf).forEach { m ->
                        manifest[m.groupValues[1]] = m.groupValues[2]
                    }

                    // Spine order
                    val spine = Regex("<itemref[^>]+idref=\"([^\"]+)\"[^>]*/?>").findAll(opf)
                        .map { it.groupValues[1] }.toList()

                    val base = if (rootFile.contains('/')) rootFile.substringBeforeLast('/') + "/" else ""

                    for (idref in spine) {
                        val href = manifest[idref] ?: continue
                        val full = if (href.startsWith(base)) href else base + href
                        val content = entries[full] ?: entries[href] ?: continue
                        val html = String(content, Charsets.UTF_8)
                        val doc = Jsoup.parse(html)
                        val body = doc.body()?.text() ?: doc.text()
                        if (body.isNotBlank()) {
                            sb.append(body).append("\n\n")
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "EPUB extraction partial failure: ${e.message}")
        }
        return sb.toString().trim()
    }

    init {
        // Register for activity results so we can surface native document/folder pickers
        // (OpenDocument + OpenDocumentTree) to JS, mirroring Kvak's SAF UX.
        // Persistable permission is taken here (before resolve) so subsequent list/read
        // calls from JS can traverse the granted tree.
        reactApplicationContext.addActivityEventListener(object : BaseActivityEventListener() {
            override fun onActivityResult(
                activity: Activity,
                requestCode: Int,
                resultCode: Int,
                data: Intent?
            ) {
                if (requestCode != PICK_RAG_DOC && requestCode != PICK_RAG_DIR) return
                val isDoc = requestCode == PICK_RAG_DOC
                val promise = if (isDoc) pickDocPromise else pickDirPromise
                pickDocPromise = null
                pickDirPromise = null

                if (resultCode == Activity.RESULT_OK && data?.data != null) {
                    val uri = data.data!!
                    try {
                        reactApplicationContext.contentResolver.takePersistableUriPermission(
                            uri,
                            PERSISTABLE_URI_FLAGS
                        )
                    } catch (se: SecurityException) {
                        Log.w(TAG, "takePersistableUriPermission: ${se.message}")
                        // continue; grant may still be usable for this process
                    }

                    var name = uri.lastPathSegment ?: if (isDoc) "document" else "Folder"
                    if (isDoc) {
                        try {
                            reactApplicationContext.contentResolver.query(
                                uri, null, null, null, null
                            )?.use { cursor ->
                                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                                if (idx >= 0 && cursor.moveToFirst()) {
                                    cursor.getString(idx)?.let { name = it }
                                }
                            }
                        } catch (_: Exception) {}
                    } else {
                        try {
                            val treeDocId = DocumentsContract.getTreeDocumentId(uri)
                            val derived = treeDocId.substringAfterLast(':').substringAfterLast('/')
                            if (derived.isNotEmpty()) name = derived
                        } catch (_: Exception) {}
                    }

                    val map = Arguments.createMap().apply {
                        putString("uri", uri.toString())
                        putString("name", name)
                    }
                    promise?.resolve(map)
                } else {
                    promise?.resolve(null)
                }
            }
        })
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
    fun loadEmbedModel(modelPath: String, promise: Promise) {
        try {
            val ok = LlamaBridge.loadEmbedModel(modelPath)
            if (ok) promise.resolve(true) else promise.reject("LOAD_EMBED_ERROR", "Failed to load embed model")
        } catch (e: Exception) { promise.reject("LOAD_EMBED_ERROR", e.message) }
    }

    @ReactMethod
    fun getEmbeddings(text: String, promise: Promise) {
        try {
            val emb = LlamaBridge.getEmbeddings(text)
            val arr = Arguments.createArray()
            for (v in emb) arr.pushDouble(v.toDouble())
            promise.resolve(arr)
        } catch (e: Exception) { promise.reject("EMBED_ERROR", e.message) }
    }

    @ReactMethod
    fun freeEmbedModel(promise: Promise) {
        try { LlamaBridge.freeEmbed(); promise.resolve(true) }
        catch (e: Exception) { promise.reject("FREE_EMBED_ERROR", e.message) }
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
                    if (success) {
                        promise.resolve(true)
                    } else {
                        promise.reject("DOWNLOAD_FAILED", error ?: "Unknown download error for $filename")
                    }
                } catch (e: Exception) {
                    promise.reject("DOWNLOAD_EMIT_ERROR", e.message)
                }
            }
        )
    }

    /**
     * List immediate children under a (sub)folder inside a previously picked SAF tree.
     * parentDocId = null => list the tree root itself.
     * Returns entries with full document "uri" (usable for readSafTextDocument) + "docId"
     * (needed to recurse into subdirs by passing as parentDocId on next call).
     *
     * Uses bulk DocumentsContract query (efficient, like Kvak's traverseTree).
     *
     * Single @ReactMethod (no overloads) because RN 0.85+ TurboModule parsing does not support
     * multiple @ReactMethod with the same name (even with different arities).
     * JS callers must always pass the second arg (null for root).
     */
    @ReactMethod
    fun listSafDirectory(treeUriString: String, parentDocId: String?, promise: Promise) {
        try {
            val treeUri = Uri.parse(treeUriString)
            val resolver = reactApplicationContext.contentResolver
            val rootDocId = DocumentsContract.getTreeDocumentId(treeUri)
            val parentId = parentDocId ?: rootDocId
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
            val docs = mutableListOf<Map<String, Any>>()
            resolver.query(
                childrenUri,
                arrayOf(
                    DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                    DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                    DocumentsContract.Document.COLUMN_MIME_TYPE
                ),
                null, null, null
            )?.use { cursor ->
                while (cursor.moveToNext()) {
                    val docId = cursor.getString(0) ?: continue
                    val name = cursor.getString(1) ?: continue
                    val mime = cursor.getString(2) ?: ""
                    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, docId)
                    docs.add(
                        mapOf(
                            "name" to name,
                            "uri" to docUri.toString(),
                            "isDirectory" to (mime == DocumentsContract.Document.MIME_TYPE_DIR),
                            "docId" to docId
                        )
                    )
                }
            }
            val arr = Arguments.createArray()
            docs.forEach { m ->
                val map = Arguments.createMap()
                m.forEach { (k, v) ->
                    when (v) {
                        is String -> map.putString(k, v)
                        is Boolean -> map.putBoolean(k, v)
                    }
                }
                arr.pushMap(map)
            }
            promise.resolve(arr)
        } catch (e: Exception) {
            promise.reject("LIST_SAF_ERROR", e.message)
        }
    }

    @ReactMethod
    fun readSafTextDocument(docUriString: String, promise: Promise) {
        try {
            val uri = Uri.parse(docUriString)
            val resolver = reactApplicationContext.contentResolver
            val text = readSafTextInternal(resolver, uri)
            promise.resolve(text)
        } catch (e: Exception) {
            promise.reject("READ_SAF_ERROR", e.message)
        }
    }

    /**
     * Main entry for RAG document ingestion: returns clean plain text for PDF, EPUB,
     * TXT, MD, HTML, and other text files.
     *
     * Uses pdfbox-android for PDFs (extracts embedded text layer).
     * Uses Zip + Jsoup for EPUBs (follows spine for reading order, strips markup).
     * Falls back to raw UTF-8 read for everything else.
     *
     * filename hint helps choose extractor when mime is generic (e.g. application/octet-stream).
     */
    @ReactMethod
    fun extractTextFromDocument(docUriString: String, filename: String?, promise: Promise) {
        try {
            // Support direct file paths (e.g. /sdcard/Download/...) for dev/testing extraction without SAF picker.
            // Normal usage is always SAF content:// URIs from the pickers.
            if (docUriString.startsWith("/") || docUriString.startsWith("file:")) {
                val path = if (docUriString.startsWith("file:")) {
                    java.net.URI(docUriString).path ?: docUriString
                } else docUriString
                val f = java.io.File(path)
                if (f.exists()) {
                    val bytes = f.readBytes()
                    val nm = filename ?: f.name
                    val lname = nm.lowercase()
                    val t = if (lname.endsWith(".pdf")) {
                        ensurePdfBoxInitialized()
                        PDDocument.load(java.io.ByteArrayInputStream(bytes)).use { d ->
                            PDFTextStripper().getText(d).trim()
                        }
                    } else if (lname.endsWith(".epub")) {
                        // EPUB direct bytes test path: full spine parser lives in extractEpubText (uses stream).
                        // For this dev hook we just acknowledge; real EPUBs will use the picker path.
                        "[EPUB direct test] bytes=${bytes.size} (use picker for full extract via zip+jsoup)"
                    } else {
                        String(bytes, Charsets.UTF_8)
                    }
                    promise.resolve(t)
                    return
                }
            }

            val uri = Uri.parse(docUriString)
            val resolver = reactApplicationContext.contentResolver
            val name = filename ?: run {
                var n = "document.bin"
                try {
                    resolver.query(uri, null, null, null, null)?.use { cursor ->
                        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0 && cursor.moveToFirst()) {
                            cursor.getString(idx)?.let { n = it }
                        }
                    }
                } catch (_: Exception) {}
                n
            }
            val lower = name.lowercase()
            val mime = try { resolver.getType(uri) ?: "" } catch (_: Exception) { "" }

            val text = when {
                lower.endsWith(".pdf") || mime.contains("pdf") -> extractPdfText(resolver, uri)
                lower.endsWith(".epub") || mime.contains("epub") -> extractEpubText(resolver, uri)
                else -> readSafTextInternal(resolver, uri)
            }
            promise.resolve(text)
        } catch (e: Exception) {
            Log.w(TAG, "extractTextFromDocument error for $docUriString ($filename): ${e.message}")
            // last-ditch fallback
            try {
                val uri = Uri.parse(docUriString)
                val resolver = reactApplicationContext.contentResolver
                promise.resolve(readSafTextInternal(resolver, uri))
            } catch (e2: Exception) {
                promise.reject("EXTRACT_TEXT_ERROR", e.message ?: e2.message)
            }
        }
    }

    /**
     * Launch system document picker (OpenDocument) filtered for text-ish content.
     * Returns {uri, name} after granting persistable permission, or null on cancel.
     * JS caller then uses readSafTextDocument + addRAGDocument.
     */
    @ReactMethod
    fun pickDocument(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(null)
            return
        }
        if (pickDocPromise != null) {
            promise.reject("PICK_IN_PROGRESS", "Document pick already in progress")
            return
        }
        pickDocPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("text/plain", "text/markdown", "text/*", "application/pdf", "application/epub+zip")
            )
        }
        activity.startActivityForResult(intent, PICK_RAG_DOC)
    }

    /**
     * Launch system folder picker (OpenDocumentTree).
     * Seeds initial URI to Downloads on API 29+ (like Kvak) to avoid the Android 11+
     * "Can't use this folder" privacy restriction when DocumentsUI starts at root.
     * Takes persistable READ|WRITE permission before resolving so recursive list/read
     * from JS (during ingest) and future re-syncs succeed.
     */
    @ReactMethod
    fun pickDirectory(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(null)
            return
        }
        if (pickDirPromise != null) {
            promise.reject("PICK_IN_PROGRESS", "Directory pick already in progress")
            return
        }
        pickDirPromise = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                // Seed at Downloads (public) so user can still navigate anywhere but avoids
                // the root privacy banner that blocks selecting subfolders.
                intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, MediaStore.Downloads.EXTERNAL_CONTENT_URI)
            } catch (_: Exception) {}
        }
        activity.startActivityForResult(intent, PICK_RAG_DIR)
    }
}
