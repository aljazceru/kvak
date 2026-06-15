cmake_minimum_required(VERSION 3.22)
project(mango_whisper)

set(WHISPER_DIR "/home/lio/g/whisper.cpp")

add_library(mango_whisper SHARED
    ${CMAKE_CURRENT_SOURCE_DIR}/../jni/whisper_bridge.cpp
)

target_include_directories(mango_whisper PRIVATE
    ${WHISPER_DIR}/include
    ${WHISPER_DIR}/ggml/include
)

# Pre-built whisper.cpp
set(LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/arm64-v8a")

add_library(whisper SHARED IMPORTED)
set_target_properties(whisper PROPERTIES IMPORTED_LOCATION ${LIB_DIR}/libwhisper.so)

find_library(log-lib log)

target_link_libraries(mango_whisper whisper ${log-lib})
