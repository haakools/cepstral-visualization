import { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [wasmModule, setWasmModule] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [coefficients, setCoefficients] = useState(Array(13).fill(0));
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const analyzerRef = useRef(null);
  const sourceRef = useRef(null);


    async function loadWasm() {
        try {
            console.log('Starting WASM load...');
            const moduleFactory = await import('./wasm/signal_processor.js');
            const Module = await moduleFactory.default();

            processorRef.current = new Module.SignalProcessor();
            setWasmModule(Module);
            console.log('SignalProcessor created successfully');
        } catch (err) {
            console.error('WASM loading error:', err);
            setError('Failed to initialize audio processor: ' + err.message);
        }
    }

    useEffect(() => {
        loadWasm();
        return () => {
            if (processorRef.current) {
                processorRef.current.delete();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const processAudioFrame = () => {
        if (!isProcessing || !processorRef.current || !analyzerRef.current) {
            console.log('Skipping frame processing because:', {
                isProcessing,
                hasProcessor: !!processorRef.current,
                hasAnalyzer: !!analyzerRef.current
            });
            return;
        }

        console.log('Getting audio data...');
        const buffer = new Float32Array(analyzerRef.current.frequencyBinCount);
        analyzerRef.current.getFloatTimeDomainData(buffer);
        console.log('Buffer size:', buffer.length, 'First few samples:', buffer.slice(0, 5));

        try {
            // Convert buffer to WASM vector
            console.log('Converting to WASM vector...');
            const inputVector = new wasmModule.FloatVector();
            buffer.forEach(sample => inputVector.push_back(sample));
            console.log('Input vector size:', inputVector.size());

            // Process audio and get coefficients
            console.log('Processing samples...');
            const results = processorRef.current.processSamples(inputVector);
            console.log('Got results:', results);

            setCoefficients(Array.from(results));

            inputVector.delete();

            if (isProcessing) {
                requestAnimationFrame(processAudioFrame);
            }
        } catch (err) {
            console.error('Processing error:', err);
            setError('Processing error occurred: ' + err.message);
            setIsProcessing(false);
        }
    };


    const startProcessing = async () => {
        if (!wasmModule) {
            console.log('No WASM module available');
            return;
        }

        try {
            console.log('Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Got microphone stream');

            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            console.log('Created audio context');

            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            console.log('Created media stream source');

            analyzerRef.current = audioContextRef.current.createAnalyser();
            console.log('Created analyzer');

            analyzerRef.current.fftSize = 2048;
            sourceRef.current.connect(analyzerRef.current);
            console.log('Connected source to analyzer');

            // Set processing state and immediately start processing
            setIsProcessing(true);
            console.log('Starting audio processing');

            // Start the processing loop directly
            const processLoop = () => {
                const buffer = new Float32Array(analyzerRef.current.frequencyBinCount);
                analyzerRef.current.getFloatTimeDomainData(buffer);

                try {
                    const inputVector = new wasmModule.FloatVector();
                    buffer.forEach(sample => inputVector.push_back(sample));
                    console.log('Sent vector size:', inputVector.size());

                    const results = processorRef.current.processSamples(inputVector);
                    console.log('Raw results:', results);

                    // Convert to regular array
                    const resultsArray = [];
                    for (let i = 0; i < results.size(); i++) {
                        resultsArray.push(results.get(i));
                    }
                    console.log('Converted results:', resultsArray);

                    if (resultsArray.length > 0) {
                        setCoefficients(resultsArray);
                    }

                    inputVector.delete();
                    results.delete();  // Don't forget to clean up the WASM vector

                    requestAnimationFrame(processLoop);
                } catch (err) {
                    console.error('Processing error:', err);
                    setError('Processing error occurred: ' + err.message);
                }
            };




            // Start the processing loop
            processLoop();

        } catch (err) {
            console.error('Error starting audio processing:', err);
            setError('Failed to access microphone: ' + err.message);
        }
    };



    const stopProcessing = () => {
        setIsProcessing(false);
        if (sourceRef.current) {
            sourceRef.current.disconnect();
        }
    };

    const normalizeValue = (value, index) => {
  // Special handling for different coefficient ranges
  if (index === 0) {
    // C0 (energy) has much larger range
    return Math.min(Math.max((value / 500 + 1) * 50, 0), 100);
  } else if (index === 1) {
    // C1 has second largest range
    return Math.min(Math.max((value / 150 + 1) * 50, 0), 100);
  } else {
    // Other coefficients have smaller ranges
    return Math.min(Math.max((value / 50 + 1) * 50, 0), 100);
  }
};


  return (
    <div className="container">
      <h1>Cepstral Coefficients</h1>
      
      <button 
        onClick={isProcessing ? stopProcessing : startProcessing}
        className="control-button"
      >
        {isProcessing ? 'Stop' : 'Start'}
      </button>

      <div className="spectrogram">
        {coefficients.map((value, index) => (
          <div key={index} className="bar-container">
            <div 
              className="bar" 
              style={{
                height: `${normalizeValue(value)}%`
              }}
            />
            <span className="label">C{index}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;

