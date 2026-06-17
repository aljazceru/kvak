cmake_minimum_required(VERSION 3.22)
project(kvak_whisper)

# Path to a whisper.cpp checkout. Override with -DWHISPER_DIR=... or the WHISPER_DIR env var.
set(WHISPER_DIR "$ENV{WHISPER_DIR}" CACHE PATH "Path to a whisper.cpp source checkout")

add_library(kvak_whisper SHARED
    ${CMAKE_CURRENT_SOURCE_DIR}/../jni/whisper_bridge.cpp
)

target_include_directories(kvak_whisper PRIVATE
    ${WHISPER_DIR}/include
    ${WHISPER_DIR}/ggml/include
)

# Pre-built whisper.cpp
set(LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/arm64-v8a")

add_library(whisper SHARED IMPORTED)
set_target_properties(whisper PROPERTIES IMPORTED_LOCATION ${LIB_DIR}/libwhisper.so)

find_library(log-lib log)

target_link_libraries(kvak_whisper whisper ${log-lib})
