cmake_minimum_required(VERSION 3.15)
project(signal_processor)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Simplify our flags but ensure ES6 module output
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s SINGLE_FILE=0 \
    -s ENVIRONMENT='web' \
    -lembind")

add_executable(signal_processor signal_processor.cpp)
