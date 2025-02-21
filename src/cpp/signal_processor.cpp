#include <emscripten/bind.h>
#include <vector>
#include <complex>
#include <cmath>

class SignalProcessor {
public:
    SignalProcessor() {
        // Initialize mel filterbank
        initMelFilterbank(2048, 44100, 40);  // 40 mel bands
    }
    std::vector<float> processSamples(const std::vector<float>& samples) {
        // Step 1: Compute FFT
        auto spectrum = computeFFT(samples);
        
        // Step 2: Get power spectrum
        auto powerSpectrum = getPowerSpectrum(spectrum);
        
        // Step 3: Apply mel filterbank
        auto melEnergies = applyMelFilterbank(powerSpectrum);
        
        // Step 4: Take log
        for (auto& energy : melEnergies) {
            energy = std::log(std::max(energy, 1e-10f));
        }
        
        // Step 5: Apply DCT to get cepstral coefficients
        return computeDCT(melEnergies);
    }
    /** Only for testing dummy data to the front end
    std::vector<float> processSamples(const std::vector<float>& samples) {
        printf("C++: Received %zu samples\n", samples.size());

        // Create test values
        std::vector<float> testOutput(13);
        for (int i = 0; i < 13; i++) {
            testOutput[i] = static_cast<float>(i) + 1.0f;
            printf("C++: Setting test value %d = %f\n", i, testOutput[i]);
        }

        printf("C++: Returning %zu test values\n", testOutput.size());
        return testOutput;
    }
    */




private:
    std::vector<std::vector<float>> melFilterbank;
    
    void initMelFilterbank(int fftSize, float sampleRate, int numBands) {
        melFilterbank.resize(numBands);
        
        // Convert Hz to mel scale
        auto hzToMel = [](float hz) { return 2595.0f * std::log10(1.0f + hz / 700.0f); };
        auto melToHz = [](float mel) { return 700.0f * (std::pow(10.0f, mel / 2595.0f) - 1.0f); };
        
        float melMax = hzToMel(sampleRate / 2);
        float melMin = hzToMel(20);  // Start from 20 Hz
        float melStep = (melMax - melMin) / (numBands + 1);
        
        for (int i = 0; i < numBands; i++) {
            float melCenter = melMin + (i + 1) * melStep;
            float melLeft = melMin + i * melStep;
            float melRight = melMin + (i + 2) * melStep;
            
            float hzLeft = melToHz(melLeft);
            float hzCenter = melToHz(melCenter);
            float hzRight = melToHz(melRight);
            
            int binLeft = static_cast<int>(hzLeft * fftSize / sampleRate);
            int binCenter = static_cast<int>(hzCenter * fftSize / sampleRate);
            int binRight = static_cast<int>(hzRight * fftSize / sampleRate);
            
            std::vector<float>& filter = melFilterbank[i];
            filter.resize(fftSize / 2);
            
            // Create triangular filters
            for (int j = binLeft; j < binCenter; j++) {
                filter[j] = (j - binLeft) / float(binCenter - binLeft);
            }
            for (int j = binCenter; j < binRight; j++) {
                filter[j] = (binRight - j) / float(binRight - binCenter);
            }
        }
    }
    
    std::vector<std::complex<float>> computeFFT(const std::vector<float>& input) {
        int n = input.size();
        std::vector<std::complex<float>> output(n);
        
        // Convert input to complex
        for (int i = 0; i < n; i++) {
            output[i] = std::complex<float>(input[i], 0.0f);
        }
        
        // Base case
        if (n <= 1) return output;
        
        // Split into even and odd
        std::vector<std::complex<float>> even(n/2), odd(n/2);
        for (int i = 0; i < n/2; i++) {
            even[i] = output[2*i];
            odd[i] = output[2*i+1];
        }
        
        // Recursive FFT on even and odd parts
        std::vector<float> evenReal(n/2), oddReal(n/2);
        for (int i = 0; i < n/2; i++) {
            evenReal[i] = even[i].real();
            oddReal[i] = odd[i].real();
        }
        
        even = computeFFT(evenReal);
        odd = computeFFT(oddReal);
        
        // Combine results
        for (int k = 0; k < n/2; k++) {
            float angle = -2 * M_PI * k / n;
            std::complex<float> t = std::polar(1.0f, angle) * odd[k];
            output[k] = even[k] + t;
            output[k + n/2] = even[k] - t;
        }
        
        return output;
    }
    
    std::vector<float> getPowerSpectrum(const std::vector<std::complex<float>>& spectrum) {
        std::vector<float> power(spectrum.size() / 2);
        for (size_t i = 0; i < power.size(); i++) {
            power[i] = std::norm(spectrum[i]);
        }
        return power;
    }
    
    std::vector<float> applyMelFilterbank(const std::vector<float>& powerSpectrum) {
        std::vector<float> melEnergies(melFilterbank.size());
        for (size_t i = 0; i < melFilterbank.size(); i++) {
            float energy = 0;
            for (size_t j = 0; j < powerSpectrum.size(); j++) {
                energy += powerSpectrum[j] * melFilterbank[i][j];
            }
            melEnergies[i] = energy;
        }
        return melEnergies;
    }
    
    std::vector<float> computeDCT(const std::vector<float>& input) {
        int numCoeffs = 13;  // Typical number of coefficients for speech processing
        std::vector<float> coeffs(numCoeffs);
        int N = input.size();
        
        for (int k = 0; k < numCoeffs; k++) {
            float sum = 0;
            for (int n = 0; n < N; n++) {
                sum += input[n] * std::cos(M_PI * k * (2*n + 1) / (2*N));
            }
            coeffs[k] = sum;
        }
        
        return coeffs;
    }
};

EMSCRIPTEN_BINDINGS(module) {
    emscripten::class_<SignalProcessor>("SignalProcessor")
        .constructor<>()
        .function("processSamples", &SignalProcessor::processSamples);
    
    // We need to register both vector types explicitly
    emscripten::register_vector<float>("FloatVector");
    emscripten::register_vector<std::vector<float>>("FloatVectorVector");
}

