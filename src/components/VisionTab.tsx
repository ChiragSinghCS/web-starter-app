import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { ModelCategory, VideoCapture } from '@runanywhere/web';
import { VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

const LIVE_INTERVAL_MS = 2500;
const LIVE_MAX_TOKENS = 30;
const SINGLE_MAX_TOKENS = 1024;
const CAPTURE_DIM = 256; // CLIP resizes internally; larger is wasted work
const UPLOAD_MAX_DIM = 1024; // keep uploaded text readable for OCR-like tasks
const ENGINEERING_PROMPT = 'You are a senior software engineer conducting a mock technical interview. Ask me one question about computer science fundamentals, wait for my response, and then briefly evaluate my answer';

interface VisionResult {
  text: string;
  totalMs: number;
}

interface PixelFrame {
  rgbPixels: Uint8Array;
  width: number;
  height: number;
}

export function VisionTab() {
  const loader = useModelLoader(ModelCategory.Multimodal);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [liveMode, setLiveMode] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customQuestionEnabled, setCustomQuestionEnabled] = useState(false);
  const [customQuestion, setCustomQuestion] = useState('');
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);

  const videoMountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveModeRef = useRef(false);
  const uploadedImageUrlRef = useRef<string | null>(null);

  // Keep refs in sync with state so interval callbacks see latest values
  processingRef.current = processing;
  speakingRef.current = speaking;
  liveModeRef.current = liveMode;

  const stopLive = useCallback(() => {
    setLiveMode(false);
    liveModeRef.current = false;
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    const cam = captureRef.current;
    if (cam) {
      cam.stop();
      cam.videoElement.parentNode?.removeChild(cam.videoElement);
      captureRef.current = null;
    }
    setCameraActive(false);
  }, []);

  // ------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------
  const startCamera = useCallback(async () => {
    if (captureRef.current?.isCapturing) return;

    setError(null);

    try {
      const cam = new VideoCapture({ facingMode: 'environment' });
      await cam.start();
      captureRef.current = cam;

      const mount = videoMountRef.current;
      if (mount) {
        const el = cam.videoElement;
        el.style.width = '100%';
        el.style.borderRadius = '12px';
        mount.appendChild(el);
      }

      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setError(
          'Camera permission denied. On macOS, check System Settings → Privacy & Security → Camera and ensure your browser is allowed.',
        );
      } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
        setError('No camera found on this device.');
      } else if (msg.includes('NotReadable') || msg.includes('TrackStartError')) {
        setError('Camera is in use by another application.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      window.speechSynthesis.cancel();
      stopCamera();
      if (uploadedImageUrlRef.current) {
        URL.revokeObjectURL(uploadedImageUrlRef.current);
        uploadedImageUrlRef.current = null;
      }
    };
  }, [stopCamera]);

  const speakText = useCallback(async (text: string) => {
    if (!text.trim() || speakingRef.current) return;

    setError(null);

    try {
      if (!('speechSynthesis' in window)) {
        throw new Error('Speech synthesis is not supported in this browser.');
      }

      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);

        utterance.onstart = () => {
          setSpeaking(true);
          speakingRef.current = true;
        };
        utterance.onend = () => {
          setSpeaking(false);
          speakingRef.current = false;
          resolve();
        };
        utterance.onerror = () => {
          setSpeaking(false);
          speakingRef.current = false;
          reject(new Error('Speech synthesis failed.'));
        };

        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSpeaking(false);
      speakingRef.current = false;
    }
  }, []);

  const processPixels = useCallback(async (frame: PixelFrame, maxTokens: number) => {
    setProcessing(true);
    processingRef.current = true;
    setError(null);

    const t0 = performance.now();

    try {
      const bridge = VLMWorkerBridge.shared;
      if (!bridge.isModelLoaded) {
        throw new Error('VLM model not loaded in worker');
      }

      const selectedPrompt = customQuestionEnabled && customQuestion.trim()
        ? customQuestion.trim()
        : ENGINEERING_PROMPT;

      const res = await bridge.process(
        frame.rgbPixels,
        frame.width,
        frame.height,
        selectedPrompt,
        { maxTokens, temperature: 0.6 },
      );

      setResult({ text: res.text, totalMs: performance.now() - t0 });
      if (autoSpeak) {
        await speakText(res.text);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmCrash = msg.includes('memory access out of bounds')
        || msg.includes('RuntimeError');

      if (isWasmCrash) {
        setResult({ text: 'Recovering from memory error... next frame will retry.', totalMs: 0 });
      } else {
        setError(msg);
        if (liveModeRef.current) stopLive();
      }
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [customQuestionEnabled, customQuestion, stopLive, autoSpeak, speakText]);

  // ------------------------------------------------------------------
  // Core: capture + infer
  // ------------------------------------------------------------------
  const describeFrame = useCallback(async (maxTokens: number) => {
    if (processingRef.current) return;

    const cam = captureRef.current;
    if (!cam?.isCapturing) return;

    // Ensure model loaded
    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    const frame = cam.captureFrame(CAPTURE_DIM);
    if (!frame) return;

    await processPixels(frame, maxTokens);
  }, [loader, processPixels]);

  const describeUploaded = useCallback(async (maxTokens: number) => {
    if (processingRef.current || !uploadedImageUrl) return;

    // Ensure model loaded
    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    const img = new Image();
    img.src = uploadedImageUrl;
    await img.decode();

    const srcWidth = img.naturalWidth;
    const srcHeight = img.naturalHeight;
    const scale = Math.min(1, UPLOAD_MAX_DIM / Math.max(srcWidth, srcHeight));
    const width = Math.max(1, Math.round(srcWidth * scale));
    const height = Math.max(1, Math.round(srcHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      setError('Could not prepare image for analysis.');
      return;
    }

    ctx.drawImage(img, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    const rgbPixels = new Uint8Array(width * height * 3);

    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgbPixels[j] = rgba[i];
      rgbPixels[j + 1] = rgba[i + 1];
      rgbPixels[j + 2] = rgba[i + 2];
    }

    await processPixels({ rgbPixels, width, height }, maxTokens);
  }, [loader, uploadedImageUrl, processPixels]);

  // ------------------------------------------------------------------
  // Single-shot
  // ------------------------------------------------------------------
  const describeSingle = useCallback(async () => {
    if (captureRef.current?.isCapturing) {
      await describeFrame(SINGLE_MAX_TOKENS);
      return;
    }
    if (uploadedImageUrl) {
      await describeUploaded(SINGLE_MAX_TOKENS);
      return;
    }
    await startCamera();
  }, [startCamera, describeFrame, describeUploaded, uploadedImageUrl]);

  // ------------------------------------------------------------------
  // Live mode
  // ------------------------------------------------------------------
  const startLive = useCallback(async () => {
    if (!captureRef.current?.isCapturing) {
      await startCamera();
    }

    setLiveMode(true);
    liveModeRef.current = true;

    // Immediately describe first frame
    describeFrame(LIVE_MAX_TOKENS);

    // Then poll every 2.5s — skips ticks while inference is running
    liveIntervalRef.current = setInterval(() => {
      if (!processingRef.current && liveModeRef.current) {
        describeFrame(LIVE_MAX_TOKENS);
      }
    }, LIVE_INTERVAL_MS);
  }, [startCamera, describeFrame]);

  const toggleLive = useCallback(() => {
    if (liveMode) {
      stopLive();
    } else {
      startLive();
    }
  }, [liveMode, startLive, stopLive]);

  const triggerUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const clearUploadedImage = useCallback(() => {
    if (uploadedImageUrlRef.current) {
      URL.revokeObjectURL(uploadedImageUrlRef.current);
      uploadedImageUrlRef.current = null;
    }
    setUploadedImageUrl(null);
  }, []);

  const switchToCamera = useCallback(async () => {
    clearUploadedImage();
    await startCamera();
  }, [clearUploadedImage, startCamera]);

  const handleFileUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file.');
      return;
    }

    stopLive();
    stopCamera();

    clearUploadedImage();

    const objectUrl = URL.createObjectURL(file);
    uploadedImageUrlRef.current = objectUrl;
    setUploadedImageUrl(objectUrl);
    setError(null);
  }, [stopLive, stopCamera, clearUploadedImage]);

  const readAloud = useCallback(async () => {
    if (!result?.text.trim()) return;
    await speakText(result.text);
  }, [result, speakText]);

  const ttsButtonText = speaking ? 'Speaking...' : 'Read Aloud';

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="tab-panel vision-panel">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="VLM"
      />

      <div className="vision-camera">
        {!cameraActive && !uploadedImageUrl && (
          <div className="empty-state">
            <h3>📷 Camera Preview</h3>
            <p>Start camera or upload an image</p>
          </div>
        )}
        {uploadedImageUrl && (
          <img className="vision-upload-preview" src={uploadedImageUrl} alt="Uploaded preview" />
        )}
        <div ref={videoMountRef} />
      </div>

      <div className="vision-prompt-block">
        <label className="vision-prompt-label" htmlFor="vision-engineering-module">
          Engineering Module
        </label>
        <textarea
          id="vision-engineering-module"
          className="vision-prompt vision-prompt-readonly"
          value={ENGINEERING_PROMPT}
          readOnly
          rows={4}
        />
      </div>

      <label className="vision-toggle">
        <input
          type="checkbox"
          checked={customQuestionEnabled}
          onChange={(e) => setCustomQuestionEnabled(e.target.checked)}
          disabled={liveMode}
        />
        <span>Custom Question</span>
      </label>

      <label className="vision-toggle">
        <input
          type="checkbox"
          checked={autoSpeak}
          onChange={(e) => setAutoSpeak(e.target.checked)}
        />
        <span>Auto-Speak</span>
      </label>

      {customQuestionEnabled && (
        <input
          className="vision-prompt"
          type="text"
          placeholder="Ask a specific question about this image..."
          value={customQuestion}
          onChange={(e) => setCustomQuestion(e.target.value)}
          disabled={liveMode}
        />
      )}

      <div className="vision-actions">
        {!cameraActive && !uploadedImageUrl ? (
          <>
            <button className="btn btn-primary" onClick={startCamera}>Start Camera</button>
            <button className="btn" onClick={triggerUpload} disabled={processing || liveMode}>Upload Image</button>
          </>
        ) : (
          <>
            <button
              className="btn btn-primary"
              onClick={describeSingle}
              disabled={processing || (liveMode && !cameraActive)}
            >
              {processing && !liveMode ? 'Analyzing...' : 'Describe'}
            </button>
            <button
              className="btn"
              onClick={readAloud}
              disabled={processing || speaking || !result?.text}
            >
              {ttsButtonText}
            </button>
            {cameraActive && (
              <button
                className={`btn ${liveMode ? 'btn-live-active' : ''}`}
                onClick={toggleLive}
                disabled={processing && !liveMode}
              >
                {liveMode ? '⏹ Stop Live' : '▶ Live'}
              </button>
            )}
            {!cameraActive && uploadedImageUrl && (
              <>
                <button className="btn" onClick={triggerUpload} disabled={processing || liveMode}>Upload Image</button>
                <button className="btn" onClick={switchToCamera} disabled={processing || liveMode}>Use Camera</button>
              </>
            )}
          </>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        hidden
      />

      {error && (
        <div className="vision-result">
          <span className="error-text">Error: {error}</span>
        </div>
      )}

      {result && (
        <div className="vision-result">
          {liveMode && <span className="live-badge">LIVE</span>}
          <h4>Result</h4>
          <p>{result.text}</p>
          {result.totalMs > 0 && (
            <div className="message-stats">{(result.totalMs / 1000).toFixed(1)}s</div>
          )}
        </div>
      )}
    </div>
  );
}
