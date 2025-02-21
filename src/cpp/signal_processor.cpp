#include <emscripten/bind.h>
#include <emscripten/emscripten.h>
#include <vector>

class SignalProcessor {
public:
    // Constructor that logs
    SignalProcessor() {
        emscripten_run_script("console.log('SignalProcessor instance created')");
    }
    
    // Simple test method
    bool test() {
        return true;
    }
};

// Make sure we're using the correct namespace
using namespace emscripten;

EMSCRIPTEN_BINDINGS(module) {
    class_<SignalProcessor>("SignalProcessor")
        .constructor<>()
        .function("test", &SignalProcessor::test);
}

// Add a simple test function
EMSCRIPTEN_KEEPALIVE
extern "C" {
    int testFunction() {
        return 42;
    }
}
