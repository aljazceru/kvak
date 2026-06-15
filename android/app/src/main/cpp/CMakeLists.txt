cmake_minimum_required(VERSION 3.22)
project(mango_llama)

# Path to a llama.cpp checkout. Override with -DLLAMA_DIR=... or the LLAMA_DIR env var.
# NOTE: This CMakeLists rebuilds only the thin JNI bridge (libmango_llama.so).
# The gradle build does NOT invoke CMake — the committed .so files in jniLibs/
# are linked directly. Rebuild only if you change the C++ bridge or upgrade llama.cpp.
set(LLAMA_DIR "$ENV{LLAMA_DIR}" CACHE PATH "Path to a llama.cpp source checkout")
set(LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/arm64-v8a")

add_library(mango_llama SHARED
    ${CMAKE_CURRENT_SOURCE_DIR}/../jni/llama_bridge.cpp
)

target_include_directories(mango_llama PRIVATE
    ${LLAMA_DIR}/include
    ${LLAMA_DIR}/ggml/include
    ${LLAMA_DIR}/common
)

# Pre-built llama.cpp shared libraries
add_library(llama SHARED IMPORTED)
set_target_properties(llama PROPERTIES
    IMPORTED_LOCATION ${LIB_DIR}/libllama.so
)

add_library(llama-common SHARED IMPORTED)
set_target_properties(llama-common PROPERTIES
    IMPORTED_LOCATION ${LIB_DIR}/libllama-common.so
)

add_library(ggml SHARED IMPORTED)
set_target_properties(ggml PROPERTIES
    IMPORTED_LOCATION ${LIB_DIR}/libggml.so
)

add_library(ggml-base SHARED IMPORTED)
set_target_properties(ggml-base PROPERTIES
    IMPORTED_LOCATION ${LIB_DIR}/libggml-base.so
)

add_library(ggml-cpu SHARED IMPORTED)
set_target_properties(ggml-cpu PROPERTIES
    IMPORTED_LOCATION ${LIB_DIR}/libggml-cpu.so
)

find_library(log-lib log)

target_link_libraries(mango_llama
    llama
    llama-common
    ggml
    ggml-base
    ggml-cpu
    ${log-lib}
)
