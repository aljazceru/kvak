#include <jni.h>
#include <string>
#include <android/log.h>

#include "whisper.h"

#define LOG_TAG "Kvak"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static struct whisper_context *g_whisper_ctx = nullptr;

extern "C" JNIEXPORT jboolean JNICALL
Java_com_kvak_WhisperBridge_nativeLoadModel(JNIEnv *env, jobject thiz, jstring model_path) {
    const char *path = env->GetStringUTFChars(model_path, nullptr);
    LOGI("Whisper: loading model: %s", path);

    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;

    g_whisper_ctx = whisper_init_from_file_with_params(path, cparams);
    env->ReleaseStringUTFChars(model_path, path);

    if (!g_whisper_ctx) {
        LOGE("Whisper: failed to load model");
        return JNI_FALSE;
    }
    LOGI("Whisper: model loaded");
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_kvak_WhisperBridge_nativeTranscribe(JNIEnv *env, jobject thiz, jbyteArray pcm_data, jint sample_rate) {
    if (!g_whisper_ctx) {
        return env->NewStringUTF("Error: whisper model not loaded");
    }

    const int n_samples = env->GetArrayLength(pcm_data) / 2; // 16-bit PCM
    auto *pcm = new int16_t[n_samples];
    env->GetByteArrayRegion(pcm_data, 0, n_samples * 2, reinterpret_cast<jbyte*>(pcm));

    // Convert int16 to float
    auto *pcmf32 = new float[n_samples];
    for (int i = 0; i < n_samples; i++) {
        pcmf32[i] = (float)pcm[i] / 32768.0f;
    }
    delete[] pcm;

    // Run whisper
    whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wparams.print_progress = false;
    wparams.print_special = false;
    wparams.print_timestamps = false;
    wparams.print_realtime = false;
    wparams.single_segment = true;
    wparams.language = "en";
    wparams.n_threads = 4;

    if (whisper_full(g_whisper_ctx, wparams, pcmf32, n_samples) != 0) {
        delete[] pcmf32;
        return env->NewStringUTF("Error: transcription failed");
    }

    std::string result;
    const int n_segments = whisper_full_n_segments(g_whisper_ctx);
    for (int i = 0; i < n_segments; i++) {
        const char *text = whisper_full_get_segment_text(g_whisper_ctx, i);
        if (text) result += text;
    }

    delete[] pcmf32;

    // Trim whitespace
    size_t start = result.find_first_not_of(" \t\n\r");
    size_t end = result.find_last_not_of(" \t\n\r");
    if (start != std::string::npos) {
        result = result.substr(start, end - start + 1);
    }

    LOGI("Whisper: transcribed %d samples -> '%s'", n_samples, result.c_str());
    return env->NewStringUTF(result.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_kvak_WhisperBridge_nativeFreeModel(JNIEnv *env, jobject thiz) {
    if (g_whisper_ctx) {
        whisper_free(g_whisper_ctx);
        g_whisper_ctx = nullptr;
        LOGI("Whisper: model freed");
    }
}
