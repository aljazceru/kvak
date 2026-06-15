package com.mangoqvac

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Log
import kotlin.concurrent.thread

object WhisperBridge {
    private const val TAG = "MangoQVAC"

    init {
        System.loadLibrary("mango_whisper")
    }

    external fun nativeLoadModel(modelPath: String): Boolean
    external fun nativeTranscribe(pcmData: ByteArray, sampleRate: Int): String
    external fun nativeFreeModel()

    private var recording = false
    private var audioRecord: AudioRecord? = null

    fun loadModel(path: String): Boolean {
        Log.i(TAG, "WhisperBridge.loadModel: $path")
        return nativeLoadModel(path)
    }

    fun free() { nativeFreeModel() }

    fun isRecording() = recording

    /**
     * Record audio with silence detection. Stops when:
     * - User taps stop (recording = false)
     * - Silence detected for [silenceThresholdMs] after speech started
     * - Max duration [maxDurationMs] reached
     *
     * Only transcribes the FINAL audio (no garbage partials).
     */
    fun recordAndTranscribe(
        maxDurationMs: Int = 30000,
        silenceThresholdMs: Int = 1500,
        onStatus: (String) -> Unit,
        onComplete: (String) -> Unit
    ) {
        if (recording) return
        recording = true

        thread(name = "whisper-recording") {
            try {
                val sampleRate = 16000
                val bufferSize = AudioRecord.getMinBufferSize(
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )

                val record = AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    sampleRate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSize * 4 // larger buffer for reliability
                )
                audioRecord = record
                record.startRecording()

                // Dynamic buffer — grow as needed up to maxDuration
                val maxSamples = sampleRate * maxDurationMs / 1000
                val buffer = ByteArray(maxSamples * 2) // 16-bit = 2 bytes/sample
                var offset = 0

                val chunkReadSize = bufferSize * 2 // bytes to read per chunk
                var speechStarted = false
                var silenceStart = 0L
                val rmsThreshold = 500.0f // RMS threshold for speech vs silence
                var lastStatus = System.currentTimeMillis()

                onStatus("recording")

                while (offset < buffer.size && recording) {
                    val toRead = minOf(chunkReadSize, buffer.size - offset)
                    val read = record.read(buffer, offset, toRead)
                    if (read <= 0) break
                    offset += read

                    // Compute RMS of the chunk we just read
                    val chunkSamples = read / 2
                    var sumSquares = 0.0
                    for (i in 0 until chunkSamples) {
                        val byteOffset = offset - read + i * 2
                        val sample = (buffer[byteOffset].toInt() and 0xFF) or
                                (buffer[byteOffset + 1].toInt() shl 8)
                        // Convert to signed 16-bit
                        val signed = if (sample > 32767) sample - 65536 else sample
                        sumSquares += signed.toDouble() * signed.toDouble()
                    }
                    val rms = Math.sqrt(sumSquares / chunkSamples)

                    if (rms > rmsThreshold) {
                        // Speech detected
                        if (!speechStarted) {
                            speechStarted = true
                            onStatus("speech_detected")
                            Log.i(TAG, "Whisper: speech detected")
                        }
                        silenceStart = 0L
                    } else if (speechStarted) {
                        // Silence after speech
                        if (silenceStart == 0L) {
                            silenceStart = System.currentTimeMillis()
                        } else if (System.currentTimeMillis() - silenceStart > silenceThresholdMs) {
                            Log.i(TAG, "Whisper: silence detected after speech, stopping")
                            break
                        }
                    }

                    // Send periodic status (not transcription)
                    val now = System.currentTimeMillis()
                    if (now - lastStatus > 1000) {
                        val durationSec = offset / (sampleRate * 2)
                        onStatus("recording:$durationSec")
                        lastStatus = now
                    }

                    // Auto-stop if no speech for 5s from start (user didn't speak)
                    if (!speechStarted && offset > sampleRate * 10) {
                        // 10 seconds of nothing — give up
                        Log.i(TAG, "Whisper: no speech detected after 10s, stopping")
                        break
                    }
                }

                record.stop()
                record.release()
                audioRecord = null

                // Final transcription only
                val totalSamples = offset / 2
                if (totalSamples > sampleRate / 2) { // at least 0.5s of audio
                    Log.i(TAG, "Whisper: transcribing $totalSamples samples...")
                    onStatus("transcribing")
                    val finalData = ByteArray(offset)
                    System.arraycopy(buffer, 0, finalData, 0, offset)
                    val result = nativeTranscribe(finalData, sampleRate)
                    // Strip whisper special tokens like [BLANK_AUDIO], [MUSIC PLAYING], etc.
                    val trimmed = result
                        .replace("[BLANK_AUDIO]", "")
                        .replace("[MUSIC PLAYING]", "")
                        .replace("[_TT_", "")
                        .replace(Regex("\\[[^\\]]*\\]"), "")
                        .trim()
                    Log.i(TAG, "Whisper: result='$trimmed'")
                    onComplete(trimmed)
                } else {
                    Log.i(TAG, "Whisper: too little audio ($totalSamples samples)")
                    onComplete("")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Whisper recording error: ${e.message}")
                onComplete("")
            }
            recording = false
        }
    }

    fun stopRecording() {
        recording = false
        try { audioRecord?.stop(); audioRecord?.release(); audioRecord = null } catch (_: Exception) {}
    }
}
