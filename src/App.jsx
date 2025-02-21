import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
    const [wasmModule, setWasmModule] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState(null);
    const audioContextRef = useRef(null);
    const processorRef = useRef(null);
    const analyzerRef = useRef(null);
    const sourceRef = useRef(null);

    // Initialize WASM module
    useEffect(() => {
        async function loadWasm() {
            try {
                console.log('Starting WASM load...');
                const Module = await import('./wasm/signal_processor.js');
                console.log('Module imported:', Module);

                console.log('Waiting for ready...');
                await Module.ready;
                console.log('Module ready');

                console.log('Creating SignalProcessor...');
                const processor = new Module.SignalProcessor();
                console.log('Processor created:', processor);

                setWasmModule(Module);
                processorRef.current = processor;
                console.log('WASM setup complete');
            } catch (err) {
                console.error('WASM loading error details:', {
                    message: err.message,
                    stack: err.stack,
                    type: err.constructor.name
                });
                setError('Failed to initialize audio processor: ' + err.message);
            }
        }


        loadWasm();

        // Cleanup
        return () => {
            if (processorRef.current) {
                processorRef.current.delete();
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const startProcessing = async () => {
        if (!wasmModule) return;

        try {
            // Request microphone access and set up audio context
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
            sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
            analyzerRef.current = audioContextRef.current.createAnalyser();

            // Configure analyzer
            analyzerRef.current.fftSize = 2048;
            sourceRef.current.connect(analyzerRef.current);

            setIsProcessing(true);
            processAudioFrame();
        } catch (err) {
            console.error('Error starting audio processing:', err);
            setError('Failed to access microphone');
        }
    };

    const processAudioFrame = () => {
        if (!isProcessing || !processorRef.current || !analyzerRef.current) return;

        // Get audio data
        const buffer = new Float32Array(analyzerRef.current.frequencyBinCount);
        analyzerRef.current.getFloatTimeDomainData(buffer);

        // Convert audio data for WASM
        const inputVector = new wasmModule.FloatVector();
        buffer.forEach(sample => inputVector.push_back(sample));

        try {
            // Process audio data using WASM
            const coefficients = processorRef.current.processSamples(inputVector);
            console.log('Cepstral coefficients:', coefficients);

            // Here you would update your visualization

        } catch (err) {
            console.error('Processing error:', err);
            setError('Processing error occurred');
            setIsProcessing(false);
        } finally {
            inputVector.delete(); // Clean up WASM memory
        }

        // Continue processing if still active
        if (isProcessing) {
            requestAnimationFrame(processAudioFrame);
        }
    };

    const stopProcessing = () => {
        setIsProcessing(false);
        if (sourceRef.current) {
            sourceRef.current.disconnect();
        }
    };

    return (
        <div className="container">
        <h1>Cepstral Coefficient Analyzer</h1>

        {error && (
            <div className="error">
            {error}
            </div>
        )}

        <button 
        onClick={isProcessing ? stopProcessing : startProcessing}
        disabled={!wasmModule || error}
        className="control-button"
        >
        {isProcessing ? 'Stop' : 'Start'} Processing
        </button>

        <div className="visualization">
        {/* Visualization will go here */}
        <p>Coefficients will be displayed here</p>
        </div>

        <div className="status">
        Status: {!wasmModule ? 'Loading WASM...' : 
                error ? 'Error' :
                isProcessing ? 'Processing' : 'Ready'}
        </div>
        </div>
    );
}

export default App
