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
        // Ensure we have power of 2 size for FFT
        int fftSize = nextPowerOf2(samples.size());
        std::vector<float> paddedSamples = samples;
        paddedSamples.resize(fftSize, 0.0f);  // Zero-padding
        
        // Step 1: Apply window function to reduce spectral leakage
        applyHammingWindow(paddedSamples);
        
        // Step 2: Compute FFT - improved implementation
        auto spectrum = computeFFT(paddedSamples);
        
        // Step 3: Get power spectrum (only need first half due to symmetry)
        auto powerSpectrum = getPowerSpectrum(spectrum);
        
        // Step 4: Apply mel filterbank
        auto melEnergies = applyMelFilterbank(powerSpectrum);
        
        // Step 5: Take log (with proper floor value to avoid numerical issues)
        for (auto& energy : melEnergies) {
            energy = std::log(std::max(energy, 1e-10f));
        }
        
        // Step 6: Apply DCT to get cepstral coefficients (with proper normalization)
        return computeDCT(melEnergies);
    }

private:
    std::vector<std::vector<float>> melFilterbank;
    
    // Helper to find next power of 2
    int nextPowerOf2(int n) {
        int power = 1;
        while (power < n) {
            power *= 2;
        }
        return power;
    }
    
    // Apply Hamming window to reduce spectral leakage
    void applyHammingWindow(std::vector<float>& samples) {
        int n = samples.size();
        for (int i = 0; i < n; i++) {
            // Hamming window: 0.54 - 0.46 * cos(2πi/(n-1))
            float window = 0.54f - 0.46f * std::cos(2.0f * M_PI * i / (n - 1));
            samples[i] *= window;
        }
    }

    void initMelFilterbank(int fftSize, float sampleRate, int numBands) {
        melFilterbank.resize(numBands);
        
        // Convert Hz to mel scale
        auto hzToMel = [](float hz) { return 2595.0f * std::log10(1.0f + hz / 700.0f); };
        auto melToHz = [](float mel) { return 700.0f * (std::pow(10.0f, mel / 2595.0f) - 1.0f); };
        
        float melMax = hzToMel(sampleRate / 2);
        float melMin = hzToMel(20);  // Start from 20 Hz
        float melStep = (melMax - melMin) / (numBands + 1);
        
        // Only need half of FFT size due to symmetry
        int filterLength = fftSize / 2 + 1;
        
        for (int i = 0; i < numBands; i++) {
            float melCenter = melMin + (i + 1) * melStep;
            float melLeft = melMin + i * melStep;
            float melRight = melMin + (i + 2) * melStep;
            
            float hzLeft = melToHz(melLeft);
            float hzCenter = melToHz(melCenter);
            float hzRight = melToHz(melRight);
            
            int binLeft = static_cast<int>(std::floor(hzLeft * filterLength / (sampleRate/2)));
            int binCenter = static_cast<int>(std::floor(hzCenter * filterLength / (sampleRate/2)));
            int binRight = static_cast<int>(std::floor(hzRight * filterLength / (sampleRate/2)));
            
            // Ensure bins are within valid range
            binLeft = std::max(0, std::min(filterLength-1, binLeft));
            binCenter = std::max(0, std::min(filterLength-1, binCenter));
            binRight = std::max(0, std::min(filterLength-1, binRight));
            
            std::vector<float>& filter = melFilterbank[i];
            filter.resize(filterLength, 0.0f);  // Initialize all to zero explicitly
            
            // Create triangular filters
            for (int j = binLeft; j <= binCenter; j++) {
                if (binCenter > binLeft)  // Avoid division by zero
                    filter[j] = (j - binLeft) / float(binCenter - binLeft);
            }
            for (int j = binCenter; j <= binRight; j++) {
                if (binRight > binCenter)  // Avoid division by zero
                    filter[j] = (binRight - j) / float(binRight - binCenter);
            }
        }
    }
    
    // Iterative FFT implementation using Cooley-Tukey algorithm
    std::vector<std::complex<float>> computeFFT(const std::vector<float>& input) {
        int n = input.size();
        
        // Convert input to complex
        std::vector<std::complex<float>> output(n);
        for (int i = 0; i < n; i++) {
            output[i] = std::complex<float>(input[i], 0.0f);
        }
        
        // Bit-reversal permutation
        int bits = 0;
        while ((1 << bits) < n) bits++;
        
        for (int i = 0; i < n; i++) {
            int rev = 0;
            for (int j = 0; j < bits; j++) {
                rev = (rev << 1) | ((i >> j) & 1);
            }
            if (i < rev) {
                std::swap(output[i], output[rev]);
            }
        }
        
        // Cooley-Tukey FFT
        for (int len = 2; len <= n; len <<= 1) {
            float angle = -2 * M_PI / len;
            std::complex<float> wlen(std::cos(angle), std::sin(angle));
            
            for (int i = 0; i < n; i += len) {
                std::complex<float> w(1.0f, 0.0f);
                for (int j = 0; j < len / 2; j++) {
                    std::complex<float> u = output[i + j];
                    std::complex<float> v = w * output[i + j + len/2];
                    
                    output[i + j] = u + v;
                    output[i + j + len/2] = u - v;
                    
                    w *= wlen;
                }
            }
        }
        
        return output;
    }
    
    std::vector<float> getPowerSpectrum(const std::vector<std::complex<float>>& spectrum) {
        // Only need first half + 1 due to symmetry (real signals)
        int n = spectrum.size() / 2 + 1;
        std::vector<float> power(n);
        
        for (int i = 0; i < n; i++) {
            // |X|² = real² + imag²
            power[i] = std::norm(spectrum[i]);
        }
        
        return power;
    }
    
    std::vector<float> applyMelFilterbank(const std::vector<float>& powerSpectrum) {
        std::vector<float> melEnergies(melFilterbank.size(), 0.0f);
        
        for (size_t i = 0; i < melFilterbank.size(); i++) {
            const auto& filter = melFilterbank[i];
            float energy = 0.0f;
            
            // Only need to multiply for non-zero filter values
            for (size_t j = 0; j < std::min(powerSpectrum.size(), filter.size()); j++) {
                energy += powerSpectrum[j] * filter[j];
            }
            
            melEnergies[i] = energy;
        }
        
        return melEnergies;
    }
    
    std::vector<float> computeDCT(const std::vector<float>& input) {
        int numCoeffs = 13;  // Typical number of coefficients for MFCC
        std::vector<float> coeffs(numCoeffs);
        int N = input.size();
        
        // Normalization factor
        float normFactor0 = 1.0f / std::sqrt(N);
        float normFactor = std::sqrt(2.0f / N);
        
        for (int k = 0; k < numCoeffs; k++) {
            float sum = 0.0f;
            for (int n = 0; n < N; n++) {
                sum += input[n] * std::cos(M_PI * k * (2*n + 1) / (2.0f * N));
            }
            
            // Apply normalization
            if (k == 0)
                coeffs[k] = sum * normFactor0;
            else
                coeffs[k] = sum * normFactor;
        }
        
        return coeffs;
    }
};

EMSCRIPTEN_BINDINGS(module) {
    emscripten::class_<SignalProcessor>("SignalProcessor")
        .constructor<>()
        .function("processSamples", &SignalProcessor::processSamples);
    
    // Register vector types
    emscripten::register_vector<float>("FloatVector");
    emscripten::register_vector<std::vector<float>>("FloatVectorVector");
}

