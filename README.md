# INTERN AI 🎙️🧠
**Offline, Secure, AI-Powered Technical Interview Intelligence.**

Intern AI is a completely private, on-device technical interview simulator. Built for candidates to practice their skills without limits, without subscriptions, and without sending their personal voice data to the cloud. 

Powered by the `@runanywhere/web` SDK, Intern AI runs entirely in your browser using WebGPU and WebAssembly. **No servers. No API keys. 100% private.**

---

## ✨ Key Features

* 🎙️ **Real-Time Voice Pipeline:** Speak naturally. Intern AI uses Silero VAD to detect when you are talking and Sherpa-ONNX (Whisper) to transcribe your speech instantly offline.
* 🧠 **Local LLM Engine:** The "brain" of the interviewer runs on an LFM2 350M model executed directly on your device's GPU via `llama.cpp` in the browser.
* 📚 **Offline RAG (Retrieval-Augmented Generation):** Context is everything. Intern AI utilizes local document parsing and context-injection to tailor the interview directly to your specific background and the target role—all processed locally without external API calls.
* ♿ **Inclusive by Design (A11y):** We believe interview prep should be accessible to everyone. The UI is built with deep screen-reader compatibility and semantic HTML specifically optimized for **Braille displays** (utilizing targeted `.sr-only` CSS techniques) to fully support visually impaired candidates.
* 📊 **Instant Analytics & Scorecards:** After the interview, Intern AI processes the conversation history and generates a structured JSON scorecard, evaluating your technical accuracy, communication, and areas for growth.
* 🔒 **Zero-Trust Privacy:** Your voice, your resume, and your mistakes never leave your laptop. Everything is processed locally and cached in your browser's OPFS (Origin Private File System).

---

## 🚀 Quick Start (Local Development)

Want to run the Intern AI interviewer on your own machine? It takes less than 2 minutes to boot.

# 1. Clone the repository and install dependencies
npm install

# 2. Start the local development server
npm run dev

## 🏗️ Architecture & How It Works

Intern AI replaces traditional cloud API calls with hardcore browser engineering. 

**The Tech Stack:**
* **Frontend:** React, TypeScript, Vite, Tailwind/Custom CSS.
* **AI Engine:** `@runanywhere/web` SDK.
* **WASM Modules:** `llama.cpp` (LLM/VLM), `whisper.cpp` / `sherpa-onnx` (STT/TTS).
* **Storage:** OPFS (Origin Private File System) for lightning-fast model caching.

**The Pipeline:**
1. **Context & RAG:** The user's target role and context are loaded into the local engine's prompt architecture.
2. **Audio Capture:** Your microphone feeds into a local SharedArrayBuffer.
3. **VAD & STT:** The WebAssembly worker detects speech and transcribes it offline.
4. **LLM Inference:** The transcribed text is sent to the local LLM, which adopts the persona of an expert technical interviewer.
5. **JSON Extraction:** Once the interview concludes, a secondary hidden prompt forces the LLM to output pure JSON, which is parsed by the React frontend into a beautiful `ScorecardDashboard`.

---

## 💻 Browser Requirements

Because Intern AI runs massive AI models locally, you need a modern browser to unleash its full potential:
* **Chrome 113+ or Edge 113+** (Required for WebGPU support).
* **Hardware:** A dedicated GPU or modern integrated graphics (Apple Silicon M1/M2/M3 works beautifully).
* **Memory:** At least 8GB of system RAM.
* *Note: Cross-Origin-Isolation headers are required and enabled by default in our Vite config for SharedArrayBuffer support.*
