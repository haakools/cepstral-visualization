#include <emscripten/bind.h>
#include <vector>
#include <complex>
#include <cmath>

class SignalProcessor {
public:
    std::vector<float> processSamples(const std::vector<float>& samples) {
        auto fftResult = computeFFT(samples);
        auto powerSpectrum = toPowerSpectrum(fftResult);
        return computeCepstral(powerSpectrum);
    }

private:
    std::vector<std::complex<float>> computeFFT(const std::vector<float>& input) {
        // Simple FFT implementation
        size_t n = input.size();
        std::vector<std::complex<float>> result(n);
        
        // Convert real input to complex
        for (size_t i = 0; i < n; i++) {
            result[i] = std::complex<float>(input[i], 0.0f);
        }
        
        // Basic FFT implementation (this should be replaced with a proper FFT library)
        // This is just to make the linker happy
        return result;
    }

    std::vector<float> toPowerSpectrum(const std::vector<std::complex<float>>& fft) {
        std::vector<float> powerSpectrum(fft.size());
        for (size_t i = 0; i < fft.size(); i++) {
            powerSpectrum[i] = std::norm(fft[i]);
        }
        return powerSpectrum;
    }

    std::vector<float> computeCepstral(const std::vector<float>& powerSpectrum) {
        std::vector<float> logSpectrum(powerSpectrum.size());
        for (size_t i = 0; i < powerSpectrum.size(); i++) {
            logSpectrum[i] = std::log(powerSpectrum[i] + 1e-6f);
        }
        
        // Simplified DCT implementation
        size_t numCoeffs = 13;  // Number of cepstral coefficients to compute
        std::vector<float> cepstral(numCoeffs);
        size_t N = logSpectrum.size();
        
        for (size_t k = 0; k < numCoeffs; k++) {
            float sum = 0.0f;
            for (size_t n = 0; n < N; n++) {
                sum += logSpectrum[n] * std::cos(M_PI * k * (2.0f * n + 1.0f) / (2.0f * N));
            }
            cepstral[k] = sum;
        }
        
        return cepstral;
    }
};

// Binding code
EMSCRIPTEN_BINDINGS(signal_processor_module) {
    emscripten::class_<SignalProcessor>("SignalProcessor")
        .constructor<>()
        .function("processSamples", &SignalProcessor::processSamples);
    
    emscripten::register_vector<float>("FloatVector");
}
