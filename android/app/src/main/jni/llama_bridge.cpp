#include <jni.h>
#include <string>
#include <android/log.h>
#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>

#include "llama.h"
#include "ggml.h"

#include <condition_variable>
#include <mutex>
#include <functional>

#define LOG_TAG "MangoQVAC"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

static llama_model *g_model = nullptr;
static llama_context *g_ctx = nullptr;
static const llama_vocab *g_vocab = nullptr;

// Streaming state
static std::mutex g_stream_mutex;
static volatile bool g_stop_requested = false;

extern "C" JNIEXPORT jboolean JNICALL
Java_com_mangoqvac_LlamaBridge_nativeLoadModel(JNIEnv *env, jobject thiz, jstring model_path) {
    const char *path = env->GetStringUTFChars(model_path, nullptr);
    LOGI("Loading model: %s", path);

    auto model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;

    g_model = llama_model_load_from_file(path, model_params);
    env->ReleaseStringUTFChars(model_path, path);

    if (!g_model) {
        LOGE("Failed to load model");
        return JNI_FALSE;
    }

    g_vocab = llama_model_get_vocab(g_model);

    auto ctx_params = llama_context_default_params();
    ctx_params.n_ctx = 2048;
    ctx_params.n_batch = 512;
    ctx_params.n_threads = 4;
    ctx_params.n_threads_batch = 4;

    g_ctx = llama_init_from_model(g_model, ctx_params);
    if (!g_ctx) {
        LOGE("Failed to create context");
        llama_model_free(g_model);
        g_model = nullptr;
        return JNI_FALSE;
    }

    LOGI("Model loaded successfully");
    return JNI_TRUE;
}

// Non-streaming completion (kept for compatibility)
extern "C" JNIEXPORT jstring JNICALL
Java_com_mangoqvac_LlamaBridge_nativeCompletion(
    JNIEnv *env, jobject thiz, jstring prompt, jint n_predict) {

    if (!g_ctx || !g_vocab) {
        return env->NewStringUTF("Error: model not loaded");
    }

    const char *prompt_str = env->GetStringUTFChars(prompt, nullptr);

    const int max_tokens = strlen(prompt_str) + 64;
    llama_token *tokens = new llama_token[max_tokens];
    int n_tokens = llama_tokenize(g_vocab, prompt_str, strlen(prompt_str),
                                   tokens, max_tokens, true, true);
    env->ReleaseStringUTFChars(prompt, prompt_str);

    if (n_tokens < 0) {
        delete[] tokens;
        return env->NewStringUTF("Error: tokenization failed");
    }

    LOGI("Tokenized %d chars -> %d tokens", (int)strlen(prompt_str), n_tokens);

    auto sparams = llama_sampler_chain_default_params();
    auto *smpl = llama_sampler_chain_init(sparams);
    llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

    int n_processed = 0;
    const int chunk_size = 256;

    while (n_processed < n_tokens) {
        int n_chunk = std::min(chunk_size, n_tokens - n_processed);
        llama_batch batch = llama_batch_get_one(tokens + n_processed, n_chunk);
        if (llama_decode(g_ctx, batch) != 0) {
            llama_sampler_free(smpl);
            delete[] tokens;
            return env->NewStringUTF("Error: decode failed");
        }
        n_processed += n_chunk;
    }

    LOGI("Prompt processed (%d tokens), generating response", n_tokens);

    std::string result;
    int max_gen = n_predict > 0 ? n_predict : 256;

    for (int i = 0; i < max_gen; i++) {
        llama_token new_token = llama_sampler_sample(smpl, g_ctx, -1);

        if (llama_vocab_is_eog(g_vocab, new_token)) break;

        char buf[256];
        int n = llama_token_to_piece(g_vocab, new_token, buf, sizeof(buf), 0, true);
        if (n > 0) result.append(buf, n);

        llama_batch batch = llama_batch_get_one(&new_token, 1);
        if (llama_decode(g_ctx, batch) != 0) break;
    }

    llama_sampler_free(smpl);
    delete[] tokens;
    return env->NewStringUTF(result.c_str());
}

// Streaming completion — calls Java callback for each token
extern "C" JNIEXPORT jstring JNICALL
Java_com_mangoqvac_LlamaBridge_nativeStreamCompletion(
    JNIEnv *env, jobject thiz, jstring prompt, jint n_predict) {

    if (!g_ctx || !g_vocab) {
        return env->NewStringUTF("Error: model not loaded");
    }

    g_stop_requested = false;

    const char *prompt_str = env->GetStringUTFChars(prompt, nullptr);

    const int max_tokens = strlen(prompt_str) + 64;
    llama_token *tokens = new llama_token[max_tokens];
    int n_tokens = llama_tokenize(g_vocab, prompt_str, strlen(prompt_str),
                                   tokens, max_tokens, true, true);
    env->ReleaseStringUTFChars(prompt, prompt_str);

    if (n_tokens < 0) {
        delete[] tokens;
        return env->NewStringUTF("Error: tokenization failed");
    }

    auto sparams = llama_sampler_chain_default_params();
    auto *smpl = llama_sampler_chain_init(sparams);
    llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

    int n_processed = 0;
    const int chunk_size = 256;

    while (n_processed < n_tokens) {
        int n_chunk = std::min(chunk_size, n_tokens - n_processed);
        llama_batch batch = llama_batch_get_one(tokens + n_processed, n_chunk);
        if (llama_decode(g_ctx, batch) != 0) {
            llama_sampler_free(smpl);
            delete[] tokens;
            return env->NewStringUTF("Error: decode failed");
        }
        n_processed += n_chunk;
    }

    // Get reference to the Kotlin object and the onToken method
    jclass cls = env->GetObjectClass(thiz);
    jmethodID onTokenMethod = env->GetMethodID(cls, "onStreamToken", "(Ljava/lang/String;)V");
    jmethodID onDoneMethod = env->GetMethodID(cls, "onStreamDone", "()V");

    std::string result;
    int max_gen = n_predict > 0 ? n_predict : 256;

    for (int i = 0; i < max_gen; i++) {
        if (g_stop_requested) {
            LOGI("Stream stopped at token %d", i);
            break;
        }

        llama_token new_token = llama_sampler_sample(smpl, g_ctx, -1);

        if (llama_vocab_is_eog(g_vocab, new_token)) break;

        char buf[256];
        int n = llama_token_to_piece(g_vocab, new_token, buf, sizeof(buf), 0, true);
        if (n > 0) {
            std::string token_str(buf, n);
            result.append(token_str);
            // Callback to Kotlin with each token
            jstring jtoken = env->NewStringUTF(token_str.c_str());
            env->CallVoidMethod(thiz, onTokenMethod, jtoken);
            env->DeleteLocalRef(jtoken);
        }

        llama_batch batch = llama_batch_get_one(&new_token, 1);
        if (llama_decode(g_ctx, batch) != 0) break;
    }

    // Signal completion
    env->CallVoidMethod(thiz, onDoneMethod);

    llama_sampler_free(smpl);
    delete[] tokens;
    return env->NewStringUTF(result.c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_com_mangoqvac_LlamaBridge_nativeStopGeneration(JNIEnv *env, jobject thiz) {
    g_stop_requested = true;
    LOGI("Stop generation requested");
}

extern "C" JNIEXPORT void JNICALL
Java_com_mangoqvac_LlamaBridge_nativeFreeModel(JNIEnv *env, jobject thiz) {
    if (g_ctx) { llama_free(g_ctx); g_ctx = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_vocab = nullptr;
    LOGI("Model freed");
}
