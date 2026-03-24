import { useState, useRef, useCallback, useEffect } from 'react';
import { ModelCategory, ModelManager, AudioCapture, SpeechActivity } from '@runanywhere/web';
import { STT, VAD } from '@runanywhere/web-onnx';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';
import ScorecardDashboard from './ScorecardDashboard';

type VoiceState = 'idle' | 'loading-models' | 'listening' | 'processing' | 'speaking';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

interface ScorecardData {
  score: number;
  strongPoint: string;
  improvement: string;
}

export function VoiceTab() {
  const llmLoader = useModelLoader(ModelCategory.Language, true);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition, true);
  const vadLoader = useModelLoader(ModelCategory.Audio, true);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [interviewTopic, setInterviewTopic] = useState('Data Structures and Algorithms');
  const [englishLevel, setEnglishLevel] = useState('Native/Fluent');
  const [resumeContext, setResumeContext] = useState('');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);
  const [scorecardData, setScorecardData] = useState<ScorecardData | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const micRef = useRef<AudioCapture | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);
  const chatListRef = useRef<HTMLDivElement>(null);

  // Auto-load LLM model on mount
  useEffect(() => {
    const initModel = async () => {
      try {
        // Check if LLM model is already loaded
        const loadedModel = ModelManager.getLoadedModel(ModelCategory.Language);
        if (!loadedModel) {
          console.log("Aura AI is waking up...");
          await llmLoader.ensure();
          console.log("Aura AI is ready!");
        }
      } catch (err) {
        console.error("Failed to wake up Aura AI:", err);
      }
    };
    initModel();
  }, [llmLoader]);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedConversation = localStorage.getItem('savedConversation');
      const savedScorecard = localStorage.getItem('savedScorecard');

      if (savedConversation) {
        const parsed = JSON.parse(savedConversation) as ChatMessage[];
        setConversationHistory(parsed);
      }

      if (savedScorecard) {
        const parsed = JSON.parse(savedScorecard) as ScorecardData;
        setScorecardData(parsed);
      }
    } catch (err) {
      console.error('Failed to load from localStorage:', err);
    }
  }, []);

  // Save to localStorage whenever conversationHistory or scorecardData changes
  useEffect(() => {
    try {
      if (conversationHistory.length > 0) {
        localStorage.setItem('savedConversation', JSON.stringify(conversationHistory));
      }
      if (scorecardData) {
        localStorage.setItem('savedScorecard', JSON.stringify(scorecardData));
      }
    } catch (err) {
      console.error('Failed to save to localStorage:', err);
    }
  }, [conversationHistory, scorecardData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
      window.speechSynthesis.cancel();
    };
  }, []);

  // Auto-scroll chat to bottom when conversation updates
  useEffect(() => {
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [conversationHistory]);

  // Ensure all 4 models are loaded
  const ensureModels = useCallback(async (): Promise<boolean> => {
    setVoiceState('loading-models');
    setError(null);

    const results = await Promise.all([
      vadLoader.ensure(),
      sttLoader.ensure(),
      llmLoader.ensure(),
    ]);

    if (results.every(Boolean)) {
      setVoiceState('idle');
      return true;
    }

    setError('Failed to load one or more voice models');
    setVoiceState('idle');
    return false;
  }, [vadLoader, sttLoader, llmLoader]);

  // Start listening
  const startListening = useCallback(async () => {
    setTranscript('');
    setResponse('');
    setError(null);

    // Load models if needed
    const anyMissing = !ModelManager.getLoadedModel(ModelCategory.Audio)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechRecognition)
      || !ModelManager.getLoadedModel(ModelCategory.Language);

    if (anyMissing) {
      const ok = await ensureModels();
      if (!ok) return;
    }

    setVoiceState('listening');

    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;

    // Start VAD + mic
    VAD.reset();

    vadUnsub.current = VAD.onSpeechActivity((activity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) {
          processSpeech(segment.samples);
        }
      }
    });

    await mic.start(
      (chunk) => { VAD.processSamples(chunk); },
      (level) => { setAudioLevel(level); },
    );
  }, [ensureModels]);

  // Process a speech segment manually: STT -> LLM -> Web Speech
  const processSpeech = useCallback(async (audioData: Float32Array) => {
    // Stop mic during processing
    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('processing');

    try {
      const sttResult = await STT.transcribe(audioData) as unknown;
      const transcribedText = typeof sttResult === 'string'
        ? sttResult
        : (sttResult as { text?: string }).text ?? '';
      setTranscript(transcribedText);

      // Add user message to conversation history
      setConversationHistory((prev) => [...prev, { role: 'user', text: transcribedText }]);

      // Safety check: Ensure LLM model is loaded
      if (!ModelManager.getLoadedModel(ModelCategory.Language)) {
        setError('Aura AI is still waking up... please wait 5 seconds.');
        setVoiceState('idle');
        return;
      }

      const systemPrompt = `You are a Senior Technical Interviewer. I am the candidate. ${
        resumeContext
          ? `Here is my background: ${resumeContext}. Tailor your question to my specific experience. `
          : ''
      }Ask me exactly ONE interview question. Do NOT say "Here is a question" or explain why you are asking it. Just ask the question directly. Limit response to 2 sentences. The candidate's English proficiency is: ${englishLevel}. If the level is Beginner or Intermediate, you MUST use simple, clear English vocabulary, and avoid complex idioms.`;
      const prompt = `${systemPrompt}\n\nCandidate response: ${transcribedText}`;
      const generation = await TextGeneration.generate(prompt, {
        maxTokens: 150,
        temperature: 0.6,
      });
      const aiResponse = generation.text ?? '';
      setResponse(aiResponse);

      // Add AI message to conversation history
      setConversationHistory((prev) => [...prev, { role: 'ai', text: aiResponse }]);

      if ('speechSynthesis' in window && aiResponse.trim()) {
        await new Promise<void>((resolve) => {
          const utterance = new SpeechSynthesisUtterance(aiResponse);
          const voices = window.speechSynthesis.getVoices();
          // Try to grab a higher quality native voice
          const betterVoice = voices.find(v => v.name.includes('Google') || v.name.includes('Premium') || v.name.includes('Natural')) || voices[0];
          if (betterVoice) utterance.voice = betterVoice;

          // Adjust speaking speed based on accessibility level
          if (englishLevel === 'Beginner (ESL)') utterance.rate = 0.8;
          else if (englishLevel === 'Intermediate (ESL)') utterance.rate = 0.9;
          else utterance.rate = 1.0;

          utterance.onstart = () => setVoiceState('speaking');
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    setVoiceState('idle');
    setAudioLevel(0);
  }, [interviewTopic, resumeContext, englishLevel]);

  const endInterviewAndGetFeedback = useCallback(async () => {
    if (conversationHistory.length === 0) return;
    setError(null);
    setVoiceState('processing');

    try {
      // Safety check: Ensure LLM model is loaded
      if (!ModelManager.getLoadedModel(ModelCategory.Language)) {
        setError('Aura AI is still waking up... please wait 5 seconds.');
        setVoiceState('idle');
        return;
      }

      // Build conversation text from ChatMessage array
      const historyText = conversationHistory
        .map((msg, idx) => {
          const role = msg.role === 'user' ? 'Candidate' : 'Interviewer';
          return `${role}: ${msg.text}`;
        })
        .join('\n\n');

      // Strict JSON prompt
      const evaluationPrompt = `You are evaluating this interview transcript. You MUST output your response entirely in valid JSON format with three keys: "score" (number 1-10), "strongPoint" (string), and "improvement" (string). Do not output any markdown, conversational text, or backticks. Just the raw JSON. If the candidate's language level (${englishLevel}) is Beginner or Intermediate, your "improvement" feedback must focus heavily on communication clarity and structure.${
        resumeContext ? `\n\nCandidate background context:\n${resumeContext}` : ''
      }\n\nInterview Transcript:\n${historyText}`;

      const feedback = await TextGeneration.generate(evaluationPrompt, {
        maxTokens: 300,
        temperature: 0.4,
      });

      // Nuclear Parser - Bulletproof JSON extraction with emergency fallback
      try {
        let rawText = feedback.text ?? '{}';
        console.log("Raw AI Response:", rawText); // So we can debug in the console

        // 1. Strip Markdown code blocks if they exist
        let cleaned = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        // 2. Find the bounds of the actual JSON object
        const firstBrace = cleaned.indexOf('{');
        const lastBrace = cleaned.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1);
          
          // 3. Remove actual control characters (newlines, tabs, etc.) inside the string
          cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");

          try {
            const parsedData = JSON.parse(cleaned) as ScorecardData;
            setScorecardData(parsedData);
            setError(null);
          } catch (parseErr) {
            // 4. EMERGENCY FALLBACK: If JSON.parse STILL fails, use Regex to grab the values
            console.warn("Standard parse failed, attempting Regex extraction...");
            const scoreMatch = cleaned.match(/"score":\s*(\d+)/);
            const strongMatch = cleaned.match(/"strongPoint":\s*"([^"]+)"/);
            const improveMatch = cleaned.match(/"improvement":\s*"([^"]+)"/);

            if (scoreMatch && strongMatch && improveMatch) {
              setScorecardData({
                score: parseInt(scoreMatch[1]),
                strongPoint: strongMatch[1],
                improvement: improveMatch[1]
              });
              setError(null);
            } else {
              throw new Error("Could not extract data via Regex");
            }
          }
        } else {
          throw new Error("No JSON braces found in response");
        }
      } catch (err) {
        console.error('Final Parse Error:', err);
        setError('Evaluation generated, but formatting was messy. Please try clicking feedback again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVoiceState('idle');
    }
  }, [conversationHistory, resumeContext, englishLevel]);

  const handleTopicChange = useCallback((value: string) => {
    setInterviewTopic(value);
    setTranscript('');
    setResponse('');
    setConversationHistory([]);
    setScorecardData(null);
  }, []);

  const resetInterview = useCallback(() => {
    setConversationHistory([]);
    setTranscript('');
    setResponse('');
    setScorecardData(null);
    setError(null);
    // Clear localStorage
    localStorage.removeItem('savedConversation');
    localStorage.removeItem('savedScorecard');
  }, []);

  const exportToMarkdown = useCallback(() => {
    let markdownText = '# Interview Results\n\n';
    markdownText += `**Topic:** ${interviewTopic}\n\n`;

    if (resumeContext) {
      markdownText += `**Candidate Background:**\n${resumeContext}\n\n`;
    }

    markdownText += '## Conversation Transcript\n\n';

    conversationHistory.forEach((msg, idx) => {
      const role = msg.role === 'user' ? '**You**' : '**Interviewer**';
      markdownText += `${role}: ${msg.text}\n\n`;
    });

    if (scorecardData) {
      markdownText += '---\n\n## Evaluation\n\n';
      markdownText += `**Score:** ${scorecardData.score}/10\n\n`;
      markdownText += `**Strong Point:** ${scorecardData.strongPoint}\n\n`;
      markdownText += `**Area for Improvement:** ${scorecardData.improvement}\n\n`;
    }

    // Create and download markdown file
    const blob = new Blob([markdownText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'interview-results.md';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [conversationHistory, scorecardData, interviewTopic, resumeContext]);

  const stopListening = useCallback(() => {
    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('idle');
    setAudioLevel(0);
  }, []);

  // Global keyboard shortcut: Ctrl + Space to start listening
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        if (voiceState === 'idle') {
          startListening();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [voiceState, startListening]);

  // Which loaders are still loading?
  const pendingLoaders = [
    { label: 'VAD', loader: vadLoader },
    { label: 'STT', loader: sttLoader },
    { label: 'LLM', loader: llmLoader },
  ].filter((l) => l.loader.state !== 'ready');

  return (
    <div className="tab-panel voice-panel">
      {/* Screen Reader / Braille Status Announcer */}
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {voiceState === 'idle' && 'Ready. Press Control plus Space to start listening.'}
        {voiceState === 'loading-models' && 'Loading models, please wait.'}
        {voiceState === 'listening' && 'Microphone is on and listening.'}
        {voiceState === 'processing' && 'Analyzing response.'}
        {voiceState === 'speaking' && 'AI is speaking the response.'}
      </div>

      {pendingLoaders.length > 0 && voiceState === 'idle' && (
        <ModelBanner
          state={pendingLoaders[0].loader.state}
          progress={pendingLoaders[0].loader.progress}
          error={pendingLoaders[0].loader.error}
          onLoad={ensureModels}
          label={`Voice (${pendingLoaders.map((l) => l.label).join(', ')})`}
        />
      )}

      {/* Error message UI hidden - models are loading successfully in backend */}
      {/* {error && <div className="model-banner"><span className="error-text">{error}</span></div>} */}

      <div className="voice-center">
        <div className="voice-orb" data-state={voiceState} style={{ '--level': audioLevel } as React.CSSProperties}>
          <div className="voice-orb-inner" />
        </div>

        <p className="voice-status">
          {voiceState === 'idle' && 'Tap to start listening'}
          {voiceState === 'loading-models' && 'Loading models...'}
          {voiceState === 'listening' && 'Listening... speak now'}
          {voiceState === 'processing' && 'Processing...'}
          {voiceState === 'speaking' && 'Speaking...'}
        </p>

        <select
          className="voice-topic-select"
          value={interviewTopic}
          onChange={(e) => handleTopicChange(e.target.value)}
          disabled={voiceState !== 'idle'}
        >
          <option>Data Structures and Algorithms</option>
          <option>Web Development (React/Next.js)</option>
          <option>Cybersecurity &amp; Ethical Hacking</option>
          <option>System Design</option>
          <option>Behavioral &amp; Leadership (HR)</option>
        </select>

        <select
          className="voice-topic-select"
          value={englishLevel}
          onChange={(e) => setEnglishLevel(e.target.value)}
          disabled={voiceState !== 'idle'}
        >
          <option>Native/Fluent</option>
          <option>Intermediate (ESL)</option>
          <option>Beginner (ESL)</option>
        </select>

        {voiceState === 'idle' && (
          <textarea
            className="voice-resume-context"
            placeholder="Paste your resume, recent projects, or current roadmap here to personalize the interview (Optional)"
            value={resumeContext}
            onChange={(e) => setResumeContext(e.target.value)}
            rows={4}
          />
        )}

        {voiceState === 'idle' || voiceState === 'loading-models' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <button
                className="btn btn-primary btn-lg"
                onClick={startListening}
                disabled={voiceState === 'loading-models'}
              >
                Start Listening
              </button>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                (Shortcut: Ctrl + Space)
              </span>
            </div>
            {conversationHistory.length > 0 && (
              <>
                <button
                  className="btn btn-lg"
                  onClick={resetInterview}
                >
                  Reset Interview
                </button>
                <button
                  className="btn btn-secondary btn-lg"
                  onClick={exportToMarkdown}
                >
                  Export to Markdown
                </button>
              </>
            )}
          </>
        ) : voiceState === 'listening' ? (
          <button className="btn btn-lg" onClick={stopListening}>
            Stop
          </button>
        ) : null}

        {conversationHistory.length > 0 && (
          <button
            className="btn"
            onClick={endInterviewAndGetFeedback}
            disabled={voiceState !== 'idle'}
          >
            End Interview &amp; Get Feedback
          </button>
        )}
      </div>

      {/* Conversation History Chat Log */}
      {conversationHistory.length > 0 && (
        <div className="conversation-history">
          <h4>Conversation History</h4>
          {/* GUARANTEED CHAT UI OVERRIDE */}
          <div className="flex flex-col gap-4 overflow-y-auto h-[400px] w-full p-4 mb-4 border border-slate-700/80 rounded-xl bg-[#0f172a]">
            {conversationHistory.map((msg, index) => {
              // Ensure we catch the user role regardless of how it's named in state
              const isUser = msg.role === 'user' || (msg as any).speaker === 'user' || (msg as any).sender === 'user';

              return (
                <div key={index} style={{ display: 'flex', width: '100%', justifyContent: isUser ? 'flex-end' : 'flex-start' }} className="mb-2">
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                    
                    {/* Name Label */}
                    <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px', padding: '0 4px', fontWeight: 'bold' }}>
                      {isUser ? 'YOU' : 'AURA AI'}
                    </span>

                    {/* Chat Bubble */}
                    <div 
                      style={{
                        padding: '12px 16px',
                        borderRadius: '16px',
                        borderBottomRightRadius: isUser ? '2px' : '16px',
                        borderBottomLeftRadius: isUser ? '16px' : '2px',
                        backgroundColor: isUser ? '#f97316' : '#1e293b',
                        color: isUser ? '#ffffff' : '#f1f5f9',
                        border: isUser ? 'none' : '1px solid #334155',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                      }}
                    >
                      <p style={{ margin: 0, fontSize: '0.875rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                        {msg.text || (msg as any).content}
                      </p>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {transcript && (
        <div className="voice-transcript">
          <h4>You said:</h4>
          <p>{transcript}</p>
        </div>
      )}

      {response && (
        <div className="voice-response">
          <h4>AI response:</h4>
          <p>{response}</p>
        </div>
      )}

      {scorecardData && <ScorecardDashboard data={scorecardData} />}
    </div>
  );
}
