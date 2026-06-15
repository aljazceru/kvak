package com.mangoqvac

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.IBinder
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.Locale

class SpeechModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        const val NAME = "SpeechModule"
        const val TAG = "MangoQVAC"
    }

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var speakPromise: Promise? = null

    init {
        Log.i(TAG, "SpeechModule: initializing TTS...")
        tryInitTTS(null)

        // Delayed check: some devices fire onInit very late
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            if (!ttsReady && tts != null) {
                Log.i(TAG, "Delayed TTS check: engines=${tts?.engines?.map { it.name }}")
                // Try to use TTS even if onInit never fired
                try {
                    val result = tts?.setLanguage(Locale.US)
                    Log.i(TAG, "Delayed setLanguage result: $result")
                    if (result != TextToSpeech.LANG_NOT_SUPPORTED) {
                        ttsReady = true
                        setupUtteranceListener()
                        Log.i(TAG, "TTS activated via delayed check!")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Delayed TTS check failed: ${e.message}")
                }
            }
        }, 5000)
    }

    private fun tryInitTTS(engine: String?) {
        val label = engine ?: "default"
        Log.i(TAG, "tryInitTTS: $label")
        try {
            tts?.shutdown()
            tts = if (engine != null) {
                TextToSpeech(reactApplicationContext, ttsInitListener, engine)
            } else {
                TextToSpeech(reactApplicationContext, ttsInitListener)
            }
            setupUtteranceListener()
        } catch (e: Exception) {
            Log.e(TAG, "TTS init exception for $label: ${e.message}")
        }
    }

    private val ttsInitListener = TextToSpeech.OnInitListener { status ->
        Log.i(TAG, "onInit fired! status=$status engine=${tts?.defaultEngine}")
        if (status == TextToSpeech.SUCCESS) {
            ttsReady = true
            tts?.language = Locale.US
            val eng = tts?.defaultEngine ?: "?"
            Log.i(TAG, "TTS initialized! engine=$eng")
            setupUtteranceListener()
            return@OnInitListener
        }

        val current = tts?.defaultEngine
        Log.w(TAG, "TTS onInit failed: status=$status engine=$current")

        // Try all known engines
        val engines = mutableListOf<String>()

        // First: whatever the system actually has installed
        try {
            val pm = reactApplicationContext.packageManager
            val intent = Intent("android.intent.action.TTS_SERVICE")
            val services = pm.queryIntentServices(intent, 0)
            for (info in services) {
                info.serviceInfo?.packageName?.let { engines.add(it) }
            }
            Log.i(TAG, "TTS services from PM: ${engines.toList()}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to query TTS services: ${e.message}")
        }

        // Also try known packages
        for (pkg in listOf(
            "app.grapheneos.speechservices",
            "com.reecedunn.espeak",
            "com.google.android.tts",
        )) {
            if (pkg !in engines) engines.add(pkg)
        }

        // Try each one
        for (eng in engines) {
            Log.i(TAG, "Trying TTS engine: $eng")
            try {
                tts?.shutdown()
                tts = TextToSpeech(reactApplicationContext, TextToSpeech.OnInitListener { s ->
                    if (s == TextToSpeech.SUCCESS) {
                        ttsReady = true
                        tts?.language = Locale.US
                        Log.i(TAG, "TTS initialized with: $eng")
                        setupUtteranceListener()
                    } else {
                        Log.w(TAG, "TTS engine $eng also failed: $s")
                    }
                }, eng)
                setupUtteranceListener()
            } catch (e: Exception) {
                Log.w(TAG, "TTS engine $eng exception: ${e.message}")
            }
        }
    }

    override fun getName() = NAME

    // ─── TTS ────────────────────────────────────────────────────────

    @ReactMethod
    fun isTTSReady(promise: Promise) { promise.resolve(ttsReady) }

    @ReactMethod
    fun getTTSEngines(promise: Promise) {
        val engines = tts?.engines ?: emptyList()
        val arr = Arguments.createArray()
        for (e in engines) {
            arr.pushMap(Arguments.createMap().apply {
                putString("name", e.name)
                putString("label", e.label)
            })
        }
        promise.resolve(arr)
    }

    @ReactMethod
    fun speak(text: String, promise: Promise) {
        if (ttsReady && tts != null) {
            tts?.stop()
            speakPromise = promise
            val params = Bundle().apply {
                putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "mango_${System.currentTimeMillis()}")
            }
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, "mango_tts")
            return
        }
        promise.reject("TTS_NOT_READY", "No TTS engine available. Enable in Settings → System → Text-to-speech")
    }

    @ReactMethod
    fun stopSpeaking(promise: Promise) {
        tts?.stop()
        speakPromise?.resolve(true)
        speakPromise = null
        promise.resolve(true)
    }

    // ─── STT (fallback) ────────────────────────────────────────────

    @ReactMethod
    fun startListening(promise: Promise) {
        if (!SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) {
            promise.reject("STT_UNAVAILABLE", "Speech recognition not available"); return
        }
        listening = true
        recognizer = SpeechRecognizer.createSpeechRecognizer(reactApplicationContext)
        recognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(p: Bundle?) { sendEvent("sttReady", null) }
            override fun onBeginningOfSpeech() { sendEvent("sttStart", null) }
            override fun onRmsChanged(r: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() { listening = false; sendEvent("sttEnd", null) }
            override fun onError(e: Int) { listening = false; sendEvent("sttError", "STT error: $e") }
            override fun onResults(r: Bundle?) {
                listening = false
                sendEvent("sttResult", r?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: "")
            }
            override fun onPartialResults(r: Bundle?) {
                val t = r?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
                if (t.isNotEmpty()) sendEvent("sttPartial", t)
            }
            override fun onEvent(e: Int, p: Bundle?) {}
        })
        recognizer?.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        })
        promise.resolve(true)
    }

    @ReactMethod
    fun stopListening(promise: Promise) { recognizer?.stopListening(); listening = false; promise.resolve(true) }
    @ReactMethod
    fun isListening(promise: Promise) { promise.resolve(listening) }
    @ReactMethod
    fun isSTTAvailable(promise: Promise) { promise.resolve(SpeechRecognizer.isRecognitionAvailable(reactApplicationContext)) }

    private fun setupUtteranceListener() {
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) { sendEvent("ttsStart", null) }
            override fun onDone(id: String?) {
                sendEvent("ttsDone", null)
                speakPromise?.resolve(true); speakPromise = null
            }
            override fun onError(id: String?) {
                sendEvent("ttsError", null)
                speakPromise?.reject("TTS_ERROR", "TTS error"); speakPromise = null
            }
        })
    }

    private fun sendEvent(name: String, value: Any?) {
        try {
            reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(name, value)
        } catch (_: Exception) {}
    }
}
