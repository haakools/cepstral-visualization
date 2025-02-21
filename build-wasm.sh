#!/bin/bash

# Exit on any error
set -e

# Directory settings - using absolute paths
ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CPP_DIR="$ROOT_DIR/src/cpp"

echo "=== Project paths ==="
echo "Root directory: $ROOT_DIR"
echo "C++ directory: $CPP_DIR"

# First check if the cpp file exists
if [ ! -f "$CPP_DIR/signal_processor.cpp" ]; then
    echo "Error: signal_processor.cpp not found in $CPP_DIR"
    exit 1
fi

echo "=== Cleaning old build files ==="
rm -rf "$CPP_DIR/CMakeFiles" \
       "$CPP_DIR/cmake_install.cmake" \
       "$CPP_DIR/CMakeCache.txt" \
       "$CPP_DIR/Makefile" \
       "$CPP_DIR/signal_processor.js" \
       "$CPP_DIR/signal_processor.wasm"

echo "=== Creating build directory ==="
cd "$CPP_DIR"

echo "=== Running CMake ==="
emcmake cmake -DCMAKE_CXX_FLAGS="-s WASM=1 -s EXPORTED_RUNTIME_METHODS=['ccall'] -s EXPORTED_FUNCTIONS=['_malloc','_free'] -s NO_EXIT_RUNTIME=1 -lembind" .

echo "=== Building with Make ==="
emmake make

echo "=== Setting up wasm directory ==="
mkdir -p "$ROOT_DIR/src/wasm"

echo "=== Copying build artifacts to wasm directory ==="
cp "$CPP_DIR/signal_processor.js" "$CPP_DIR/signal_processor.wasm" "$ROOT_DIR/src/wasm/"

echo "=== Build complete ==="
echo "Files copied to: $ROOT_DIR/src/wasm"
ls -l "$ROOT_DIR/src/wasm"
