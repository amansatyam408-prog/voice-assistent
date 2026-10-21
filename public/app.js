// Voxly — AI Voice Sales Agent Client Application
const $ = (id) => document.getElementById(id);

// Application State
let calls = [];
let transcript = [];
let isActive = false;
let currentCallId = null;
let startedAt = null;
let timerInterval = null;
let currentDurationFormatted = '00:00';
let currentDurationSeconds = 0;

// Voice & Audio State
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
let isSpeaking = false;
let isMuted = false;
let mediaRecorder = null;
let recordedChunks = [];
let currentRecordingBlob = null;
let currentRecordingUrl = null;
let activeFilter = 'all';

// AI Intelligence State
let lastStatus = 'Interested';
let pendingSummary = null;
let currentAiConfig = { ready: false, activeProvider: 'none' };
let currentVoices = [];
let selectedVoice = null;

// Product Profiles Cache
let productProfiles = {};

// Status definitions
const STATUS_OPTIONS = [
  'Converted',
  'Interested',
  'Demo Requested',
  'Follow-up Required',
  'Not Interested',
  'No Response'
];

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupVoiceSynthesis();
  await loadAiConfig();
  await loadProducts();
  await fetchCalls();
  setupEventListeners();
});

async function loadAiConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Config endpoint unreachable');
    currentAiConfig = await res.json();
    updateAiStatusUI();
  } catch (err) {
    console.warn('Could not load AI config:', err.message);
    currentAiConfig = { ready: false, activeProvider: 'none' };
    updateAiStatusUI();
  }
}

function updateAiStatusUI() {
  const pill = $('ai-status-pill');
  const dot = $('ai-indicator-dot');
  const label = $('ai-status-label');
  const sysDot = $('system-status-dot');
  const sysTitle = $('system-status-title');
  const sysSub = $('system-status-sub');

  if (currentAiConfig.ready) {
    dot.className = 'status-indicator-dot';
    label.textContent = `${currentAiConfig.activeProvider === 'gemini' ? 'Gemini 2.0' : 'OpenAI'} Active`;
    pill.title = `Connected to ${currentAiConfig.activeProvider.toUpperCase()} AI model. Click to configure.`;
    sysDot.className = 'status-dot';
    sysTitle.textContent = 'AI Voice Engine Ready';
    sysSub.textContent = `Provider: ${currentAiConfig.activeProvider.toUpperCase()}`;
  } else {
    dot.className = 'status-indicator-dot amber';
    label.textContent = 'Offline Demo Mode';
    pill.title = 'No AI API key detected. Running in offline simulation. Click to configure API Key.';
    sysDot.className = 'status-dot';
    sysDot.style.background = '#f8c055';
    sysTitle.textContent = 'Voice Engine (Offline)';
    sysSub.textContent = 'API key not configured in .env';
  }
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (res.ok) {
      productProfiles = await res.json();
      updateProductPreview();
    }
  } catch (e) {
    console.warn('Could not load products:', e.message);
  }
}

function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
}

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const target = $(`${name}-view`);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === name);
  });

  const titles = {
    call: 'Live sales call',
    history: 'Call history',
    insights: 'Sales insights'
  };
  $('page-title').textContent = titles[name] || 'Live sales call';

  if (name === 'history') renderHistory();
  if (name === 'insights') renderInsights();
}

// -------------------------------------------------------------
// Voice Synthesis (TTS) & Recognition (STT)
// -------------------------------------------------------------

function setupVoiceSynthesis() {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis not supported in this browser.');
    return;
  }

  const loadVoices = () => {
    currentVoices = speechSynthesis.getVoices();
    populateVoiceSelect();
  };

  loadVoices();
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
}

function populateVoiceSelect() {
  const select = $('settings-voice-select');
  if (!select) return;
  select.innerHTML = '<option value="default">Default Browser Voice</option>';

  currentVoices.forEach((voice, index) => {
    const opt = document.createElement('option');
    opt.value = index;
    opt.textContent = `${voice.name} (${voice.lang})${voice.default ? ' — DEFAULT' : ''}`;
    select.appendChild(opt);
  });
}

function getBestVoiceForLanguage(langCode) {
  if (!currentVoices.length) return null;

  if (langCode === 'Hindi') {
    return currentVoices.find(v => v.lang.startsWith('hi') || v.name.toLowerCase().includes('hindi')) ||
           currentVoices.find(v => v.lang === 'en-IN') || null;
  }
  if (langCode === 'Telugu') {
    return currentVoices.find(v => v.lang.startsWith('te') || v.name.toLowerCase().includes('telugu')) || null;
  }
  // English
  return currentVoices.find(v => (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Jenny')) && v.lang.startsWith('en')) ||
         currentVoices.find(v => v.lang.startsWith('en')) || null;
}

function speakText(text) {
  if (isMuted || !('speechSynthesis' in window)) {
    if (isActive) resumeListening();
    return;
  }

  // Cancel any ongoing utterance
  speechSynthesis.cancel();
  isSpeaking = true;
  updateCallState('AI Speaking...', 'speaking');
  $('orb-visual')?.classList.add('speaking');

  // Pause listening while AI speaks to avoid self-echo feedback
  pauseListening();

  const utterance = new SpeechSynthesisUtterance(text);
  const selectedLang = $('language').value;

  const voice = selectedVoice || getBestVoiceForLanguage(selectedLang);
  if (voice) utterance.voice = voice;

  utterance.lang = selectedLang === 'Hindi' ? 'hi-IN' : selectedLang === 'Telugu' ? 'te-IN' : 'en-US';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  // Chrome TTS Keepalive hack (prevents long speech timeout)
  const keepAlive = setInterval(() => {
    if (!speechSynthesis.speaking) {
      clearInterval(keepAlive);
    } else {
      speechSynthesis.pause();
      speechSynthesis.resume();
    }
  }, 10000);

  utterance.onend = () => {
    clearInterval(keepAlive);
    isSpeaking = false;
    $('orb-visual')?.classList.remove('speaking');
    if (isActive) {
      updateCallState('Listening...', 'active');
      resumeListening();
    }
  };

  utterance.onerror = (e) => {
    clearInterval(keepAlive);
    console.warn('Speech synthesis error:', e.error);
    isSpeaking = false;
    $('orb-visual')?.classList.remove('speaking');
    if (isActive) {
      updateCallState('Listening...', 'active');
      resumeListening();
    }
  };

  speechSynthesis.speak(utterance);
}

function setupRecognition() {
  if (!SpeechRecognition) {
    $('call-state-text').textContent = 'Text mode (No STT)';
    return null;
  }

  const r = new SpeechRecognition();
  r.continuous = false;
  r.interimResults = false;
  r.maxAlternatives = 1;

  const currentLang = $('language').value;
  r.lang = currentLang === 'Hindi' ? 'hi-IN' : currentLang === 'Telugu' ? 'te-IN' : 'en-US';

  r.onstart = () => {
    isListening = true;
    $('mic-btn').classList.add('listening');
    if (isActive && !isSpeaking) {
      updateCallState('Listening...', 'active');
    }
  };

  r.onend = () => {
    isListening = false;
    $('mic-btn').classList.remove('listening');
    // If call is still active and AI isn't speaking, re-engage listening
    if (isActive && !isSpeaking) {
      setTimeout(resumeListening, 300);
    }
  };

  r.onerror = (e) => {
    isListening = false;
    $('mic-btn').classList.remove('listening');
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      toast('Microphone access blocked. Click address bar lock to allow mic, or use text chat.', true);
      updateCallState('Mic Blocked (Use Text)', '');
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      console.warn('Speech recognition warning:', e.error);
    }
  };

  r.onresult = (e) => {
    const text = e.results?.[0]?.[0]?.transcript?.trim();
    if (text && isActive) {
      handleCustomerMessage(text);
    }
  };

  return r;
}

function pauseListening() {
  if (recognition && isListening) {
    try {
      recognition.onend = null;
      recognition.stop();
      isListening = false;
      $('mic-btn').classList.remove('listening');
    } catch {}
  }
}

function resumeListening() {
  if (!isActive || isSpeaking || isListening) return;

  if (!SpeechRecognition) {
    updateCallState('Text chat mode', 'active');
    return;
  }

  try {
    if (!recognition) recognition = setupRecognition();
    if (recognition) {
      const currentLang = $('language').value;
      recognition.lang = currentLang === 'Hindi' ? 'hi-IN' : currentLang === 'Telugu' ? 'te-IN' : 'en-US';
      recognition.start();
    }
  } catch (e) {
    // Recognition might already be starting or busy
  }
}

// -------------------------------------------------------------
// Live Call Session Controls
// -------------------------------------------------------------

async function startCall() {
  if (isActive) return;

  const product = $('product').value;
  const language = $('language').value;
  const consentGiven = $('consent').checked;

  currentCallId = `call_${Date.now()}`;
  isActive = true;
  transcript = [];
  recordedChunks = [];
  currentRecordingBlob = null;
  currentRecordingUrl = null;
  startedAt = Date.now();
  currentDurationSeconds = 0;
  currentDurationFormatted = '00:00';

  // Notify backend to prevent duplicate sessions
  try {
    await fetch('/api/sessions/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentCallId, product, language })
    });
  } catch (e) {
    console.warn('Session start notify error:', e.message);
  }

  // UI state
  $('transcript').innerHTML = '';
  $('session-name').textContent = `${product} Sales Call`;
  $('session-subtitle').textContent = `Connected · ${language}`;
  $('inline-recording-bar').classList.add('hidden');
  $('timer').textContent = '00:00';
  timerInterval = setInterval(updateTimer, 1000);

  updateCallState('Connecting...', 'active');
  $('start-btn').disabled = true;
  $('end-btn').disabled = false;
  $('text-input').disabled = false;
  $('send-btn').disabled = false;
  $('mic-btn').disabled = false;
  $('summary-btn').disabled = true;
  setStatus('Interested');

  // Audio Recording with explicit consent
  if (consentGiven) {
    $('rec-indicator').classList.remove('hidden');
    await startAudioRecording();
  } else {
    $('rec-indicator').classList.add('hidden');
    toast('Call started without recording (consent not checked).');
  }

  // Initial AI Opening Greeting
  const greeting = getInitialGreeting(product, language);
  addMessage('assistant', greeting);

  if (SpeechRecognition) {
    recognition = setupRecognition();
  } else {
    toast('Voice recognition is not supported in this browser. Use the text input below.');
  }

  // Speak greeting
  speakText(greeting);
}

async function startAudioRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Audio recording is not supported in this browser.', true);
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    let supportedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    mediaRecorder = new MediaRecorder(stream, supportedMime ? { mimeType: supportedMime } : {});
    recordedChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (recordedChunks.length > 0) {
        const mime = mediaRecorder.mimeType || 'audio/webm';
        currentRecordingBlob = new Blob(recordedChunks, { type: mime });
        currentRecordingUrl = URL.createObjectURL(currentRecordingBlob);

        // Convert to base64 dataURL for localStorage persistence (Vercel-compatible)
        const reader = new FileReader();
        reader.onloadend = async () => {
          const dataUrl = reader.result;
          currentRecordingUrl = dataUrl;

          // Persist the dataURL directly into the call record in localStorage
          const all = lsLoadCalls();
          const idx = all.findIndex(c => c.id === currentCallId);
          if (idx >= 0) {
            all[idx].recordingDataUrl = dataUrl;
            all[idx].hasRecording = true;
            lsSaveCalls(all);
            calls = all;
          }

          showInlineAudioPlayer(dataUrl);
          toast('Recording saved.');
        };
        reader.readAsDataURL(currentRecordingBlob);
      }
    };

    mediaRecorder.start(1000); // 1-second timeslices
  } catch (err) {
    console.warn('Microphone recording error:', err.message);
    toast('Microphone recording permission was denied. Continuing in unrecorded mode.', true);
    $('rec-indicator').classList.add('hidden');
  }
}

// uploadRecordingToBackend is no longer used (localStorage approach)
// kept as a no-op for compatibility
async function uploadRecordingToBackend(callId, blob, mimeType) {
  // No-op on Vercel — recordings stored as base64 in localStorage
}

function showInlineAudioPlayer(url) {
  const bar = $('inline-recording-bar');
  const player = $('inline-audio');
  $('rec-bar-meta').textContent = `Duration: ${currentDurationFormatted}`;
  player.src = url;
  bar.classList.remove('hidden');
}

function getInitialGreeting(product, language) {
  const customName = $('custom-product-name')?.value?.trim();
  const prodName = (product === 'Custom SaaS' && customName) ? customName : product;

  if (language === 'Hindi') {
    return `नमस्ते! मैं Voxly हूँ, आपका AI सेल्स असिस्टेंट। मैं ${prodName} के बारे में बताने के लिए यहाँ हूँ। क्या मैं जान सकता हूँ कि आपकी टीम अभी किस मुख्य काम को ऑटोमेट या बेहतर बनाना चाहती है?`;
  }
  if (language === 'Telugu') {
    return `నమస్కారం! నేను Voxly AI. ${prodName} గురించి వివరించడానికి ఇక్కడ ఉన్నాను. మీ బృందంలో ఏ ప్రక్రియను మెరుగుపరచాలనుకుంటున్నారు?`;
  }
  return `Hi there! I’m Voxly, your AI sales assistant for ${prodName}. What repetitive task or workflow challenge takes up the most time for your team today?`;
}

async function endCall() {
  if (!isActive) return;
  isActive = false;

  clearInterval(timerInterval);
  pauseListening();

  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  isSpeaking = false;
  $('orb-visual')?.classList.remove('speaking');
  $('rec-indicator').classList.add('hidden');

  // Stop recording if active
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    await new Promise(resolve => {
      mediaRecorder.addEventListener('stop', resolve, { once: true });
      mediaRecorder.stop();
    });
  }
  mediaRecorder = null;

  // Notify backend session end
  try {
    await fetch('/api/sessions/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentCallId })
    });
  } catch {}

  const finalStatus = guessLocalStatus(transcript);
  setStatus(finalStatus);

  // Update controls
  updateCallState('Call Ended', '');
  $('start-btn').disabled = false;
  $('end-btn').disabled = true;
  $('text-input').disabled = true;
  $('send-btn').disabled = true;
  $('mic-btn').disabled = true;
  $('mic-btn').classList.remove('listening');
  $('session-subtitle').textContent = `Ended · Duration ${currentDurationFormatted}`;
  $('summary-btn').disabled = transcript.length === 0;

  // Persist Call Record into localStorage (Vercel-compatible)
  await saveCallToBackend({
    id: currentCallId,
    product: $('product').value,
    language: $('language').value,
    date: new Date().toISOString(),
    durationSeconds: currentDurationSeconds,
    duration: currentDurationFormatted,
    status: finalStatus,
    transcript: [...transcript],
    summary: null,
    recordingDataUrl: null,  // will be filled in by FileReader callback above
    hasRecording: Boolean(currentRecordingBlob),
    consentGiven: $('consent').checked ? 1 : 0
  });

  await fetchCalls();
  toast('Call ended and saved.');
}

// -------------------------------------------------------------
// Message & AI Conversation Handling
// -------------------------------------------------------------

async function handleCustomerMessage(text) {
  if (!isActive || !text.trim()) return;

  addMessage('customer', text.trim());
  updateCallState('Thinking...', 'active');
  showTyping(true);

  try {
    const customProductInfo = $('product').value === 'Custom SaaS' ? {
      name: $('custom-product-name')?.value?.trim() || 'Custom SaaS',
      overview: $('custom-product-desc')?.value?.trim() || 'Custom cloud software solution.',
      tagline: 'Custom cloud software.',
      features: ['Custom workflow automation', 'Cloud integration'],
      pricing: { starter: '$29/mo', pro: '$79/mo' }
    } : null;

    const res = await fetch('/api/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text.trim(),
        product: $('product').value,
        language: $('language').value,
        history: transcript.slice(-10),
        customProductInfo
      })
    });

    showTyping(false);

    if (!res.ok) {
      let errData = {};
      try { errData = await res.json(); } catch {}
      const errMsg = errData.error || `HTTP ${res.status} Error`;
      addMessage('assistant', `⚠️ API Error: ${errMsg}. Please verify your API key in Settings or .env.`, false, true);
      toast(`AI Error: ${errMsg}`, true);
      updateCallState('API Error', '');
      return;
    }

    const data = await res.json();
    if (!isActive) return;

    addMessage('assistant', data.reply, data.isSimulated);

    // Update real-time classification
    const updatedStatus = guessLocalStatus(transcript);
    setStatus(updatedStatus);

    // Speak aloud
    speakText(data.reply);
  } catch (err) {
    showTyping(false);
    console.error('Call to /api/reply failed:', err);
    addMessage('assistant', `⚠️ Connection Error: Could not connect to AI backend (${err.message}).`, false, true);
    toast('Network error connecting to backend.', true);
  }
}

function addMessage(role, text, isSimulated = false, isError = false) {
  const item = {
    role,
    text,
    time: clock(),
    isSimulated: Boolean(isSimulated),
    isError: Boolean(isError)
  };
  transcript.push(item);
  renderMessage(item);
  updateCounts();
  return item;
}

function renderMessage(item) {
  const empty = $('transcript').querySelector('.empty-state');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = `message ${item.role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = item.role === 'assistant' ? '✳' : 'CU';

  const body = document.createElement('div');
  body.className = 'message-body';

  const head = document.createElement('div');
  head.className = 'message-head';

  const name = document.createElement('strong');
  name.textContent = item.role === 'assistant' ? 'Voxly AI' : 'Customer';

  const time = document.createElement('time');
  time.textContent = item.time || '';

  head.append(name, time);

  const bubble = document.createElement('div');
  bubble.className = `bubble ${item.isError ? 'error-bubble' : ''}`;
  bubble.textContent = item.text;

  if (item.isSimulated) {
    const badge = document.createElement('div');
    badge.className = 'sim-badge';
    badge.textContent = 'OFFLINE SIMULATION (NO API KEY)';
    bubble.append(badge);
  }

  body.append(head, bubble);
  row.append(avatar, body);

  $('transcript').append(row);
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

function showTyping(show) {
  const el = $('typing-indicator');
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
  $('transcript').scrollTop = $('transcript').scrollHeight;
}

function updateCallState(text, cls) {
  const el = $('call-state');
  $('call-state-text').textContent = text;
  el.className = `call-state ${cls || ''}`;
}

function setStatus(status) {
  lastStatus = status;
  $('status-text').textContent = status;

  const statusBorderColors = {
    'Converted': '#4e9b79',
    'Interested': '#3b6b8c',
    'Demo Requested': '#6a569c',
    'Follow-up Required': '#8a6e38',
    'Not Interested': '#703844',
    'No Response': '#323b4b'
  };

  const statusBulletColors = {
    'Converted': '#9cf4c7',
    'Interested': '#89c0f5',
    'Demo Requested': '#c7b9ff',
    'Follow-up Required': '#fbd37a',
    'Not Interested': '#ff8294',
    'No Response': '#7e8aa2'
  };

  $('outcome-status').style.borderColor = statusBorderColors[status] || '#2a374d';
  const bullet = $('outcome-status').querySelector('.status-bullet');
  if (bullet) bullet.style.background = statusBulletColors[status] || '#a79bff';
}

function updateCounts() {
  const customerTurns = transcript.filter(m => m.role === 'customer').length;
  $('turn-count').textContent = customerTurns;
  $('objection-count').textContent = countObjections(transcript);
  $('summary-btn').disabled = transcript.length === 0;
}

function countObjections(t) {
  const text = t.filter(m => m.role === 'customer').map(m => m.text.toLowerCase()).join(' ');
  return ['pric', 'cost', 'expensive', 'budget', 'afford', 'integrat', 'secur', 'privacy', 'compliance', 'not sure', 'concern', 'competitor'].filter(word => text.includes(word)).length;
}

function guessLocalStatus(t) {
  const customer = t.filter(m => m.role === 'customer').map(m => m.text.toLowerCase()).join(' ');
  if (!customer.trim()) return 'No Response';
  if (/not interested|no thanks|don't need|dont need|stop calling|waste of time/i.test(customer)) return 'Not Interested';
  if (/buy|purchase|sign up|subscribe|let's do it|ready to buy/i.test(customer)) return 'Converted';
  if (/demo|demonstration|show me|walkthrough/i.test(customer)) return 'Demo Requested';
  if (/call me|follow.?up|later|next week|email me|send details/i.test(customer)) return 'Follow-up Required';
  return 'Interested';
}

// -------------------------------------------------------------
// AI Call Summary & Intelligence Modal
// -------------------------------------------------------------

async function generateSummary() {
  if (!transcript.length) return;

  const btn = $('summary-btn');
  btn.disabled = true;
  btn.textContent = 'Analyzing Conversation…';

  try {
    const res = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        product: $('product').value
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server status ${res.status}`);
    }

    const summary = await res.json();
    pendingSummary = summary;
    renderSummaryModal(summary);
    $('summary-modal').classList.remove('hidden');
  } catch (err) {
    console.error('Summary error:', err);
    toast(`Failed to generate summary: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✧ Generate call summary <span>→</span>';
  }
}

function renderSummaryModal(s) {
  const root = $('summary-content');
  root.innerHTML = '';

  // Audio player in modal if recording exists
  const audioBox = $('modal-audio-container');
  const modalAudio = $('modal-audio-player');
  if (currentRecordingUrl) {
    modalAudio.src = currentRecordingUrl;
    audioBox.classList.remove('hidden');
  } else if (currentCallId) {
    const existing = calls.find(c => c.id === currentCallId);
    if (existing && existing.recordingDataUrl) {
      modalAudio.src = existing.recordingDataUrl;
      audioBox.classList.remove('hidden');
    } else {
      audioBox.classList.add('hidden');
    }
  } else {
    audioBox.classList.add('hidden');
  }

  // Header status tag
  const top = document.createElement('div');
  top.className = 'summary-top';

  const tag = document.createElement('span');
  const safeStatus = (s.status || lastStatus).toLowerCase().replace(/\s+/g, '');
  tag.className = `status-tag ${safeStatus}`;
  tag.textContent = s.status || lastStatus;

  const note = document.createElement('span');
  note.style.cssText = 'font-size: 10px; color: #8fa0c0;';
  note.textContent = s.source === 'gemini' ? 'Generated via Gemini 2.0 Flash' :
                     s.source === 'openai' ? 'Generated via OpenAI' :
                     'Rule-Based Extraction (Offline)';

  top.append(tag, note);
  root.append(top);

  // 1. Executive Summary
  summaryBlock(root, 'Executive Summary', s.summary || 'No summary available.');

  // 2. Customer Requirements
  summaryList(root, 'Customer Requirements & Pain Points', s.requirements);

  // 3. Questions Asked
  summaryList(root, 'Questions Asked by Customer', s.questionsAsked);

  // 4. Objections & Hesitations
  summaryList(root, 'Objections & Hesitations Raised', s.objections);

  // 5. Customer Interest Level
  summaryBlock(root, 'Customer Interest & Engagement', s.customerInterest || 'Not assessed.');

  // 6. Actionable Next Steps
  summaryList(root, 'Actionable Next Steps', s.nextSteps);
}

function summaryBlock(root, title, content) {
  const box = document.createElement('div');
  box.className = 'summary-block';
  const h = document.createElement('h3');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = content || 'None identified.';
  box.append(h, p);
  root.append(box);
}

function summaryList(root, title, items) {
  const box = document.createElement('div');
  box.className = 'summary-block';
  const h = document.createElement('h3');
  h.textContent = title;
  box.append(h);

  if (items && Array.isArray(items) && items.length > 0) {
    const ul = document.createElement('ul');
    items.forEach(x => {
      const li = document.createElement('li');
      li.textContent = x;
      ul.append(li);
    });
    box.append(ul);
  } else {
    const p = document.createElement('p');
    p.textContent = 'None identified from the conversation transcript.';
    box.append(p);
  }
  root.append(box);
}

async function saveSummaryToDatabase() {
  if (!pendingSummary || !currentCallId) return;

  const existing = calls.find(c => c.id === currentCallId);
  const updatedCall = {
    id: currentCallId,
    product: existing?.product || $('product').value,
    language: existing?.language || $('language').value,
    duration: existing?.duration || currentDurationFormatted,
    durationSeconds: existing?.durationSeconds || currentDurationSeconds,
    date: existing?.date || new Date().toISOString(),
    status: pendingSummary.status || existing?.status || lastStatus,
    transcript: existing?.transcript || transcript,
    summary: pendingSummary,
    recordingDataUrl: existing?.recordingDataUrl || null,
    hasRecording: existing?.hasRecording || Boolean(currentRecordingBlob),
    consentGiven: existing?.consentGiven !== undefined ? existing.consentGiven : ($('consent').checked ? 1 : 0)
  };

  await saveCallToBackend(updatedCall);
  await fetchCalls();
  setStatus(updatedCall.status);
  toast('Summary and classification persisted to database.');
  $('summary-modal').classList.add('hidden');
}

// -------------------------------------------------------------
// Backend Persistence & History API
// -------------------------------------------------------------

// ─────────────────────────────────────────────────────────────
// Persistence Layer — localStorage (works on Vercel + local)
// ─────────────────────────────────────────────────────────────

const LS_KEY = 'voxly_calls_v2';

function lsLoadCalls() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch { return []; }
}

function lsSaveCalls(arr) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch { }
}

async function fetchCalls() {
  try {
    calls = lsLoadCalls();
    renderHistory();
    renderInsights();
    renderNavCounts();
  } catch (err) {
    console.warn('Could not load calls from localStorage:', err.message);
  }
}

async function saveCallToBackend(callData) {
  try {
    // Persist to localStorage (works on Vercel + local)
    const all = lsLoadCalls();
    const idx = all.findIndex(c => c.id === callData.id);
    if (idx >= 0) { all[idx] = callData; } else { all.unshift(callData); }
    lsSaveCalls(all);
    calls = all;
    return callData;
  } catch (err) {
    console.error('Failed to save call to localStorage:', err.message);
  }
}

function renderHistory() {
  const root = $('history-list');
  if (!root) return;
  root.innerHTML = '';

  const searchKeyword = ($('history-search')?.value || '').trim().toLowerCase();

  let filtered = calls;
  if (activeFilter !== 'all') {
    filtered = filtered.filter(c => c.status === activeFilter);
  }

  if (searchKeyword) {
    filtered = filtered.filter(c => {
      const prodMatch = (c.product || '').toLowerCase().includes(searchKeyword);
      const transcriptMatch = (c.transcript || []).some(m => m.text.toLowerCase().includes(searchKeyword));
      return prodMatch || transcriptMatch;
    });
  }

  updateFilterCounts();

  if (filtered.length === 0) {
    root.innerHTML = '<div class="history-empty">No calls found matching your filter. Start a live call to build your persistent sales history.</div>';
    return;
  }

  filtered.forEach(call => {
    const card = document.createElement('div');
    card.className = 'history-card';

    const symbol = document.createElement('div');
    symbol.className = 'history-symbol';
    symbol.textContent = '◷';

    const info = document.createElement('div');
    info.className = 'history-info';

    const h = document.createElement('h3');
    h.textContent = `${call.product || 'SaaS'} Sales Conversation`;

    const customerPreview = (call.transcript || [])
      .filter(m => m.role === 'customer')
      .map(m => m.text)
      .join(' · ') || 'No customer responses recorded.';

    const p = document.createElement('p');
    p.textContent = customerPreview;

    info.append(h, p);

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const dateFormatted = call.date ? new Date(call.date).toLocaleDateString() : 'Recent';
    meta.textContent = `${dateFormatted} · ${call.duration || '00:00'} · ${call.language || 'English'}`;

    const tag = document.createElement('span');
    const safeStatus = (call.status || 'Interested').toLowerCase().replace(/\s+/g, '');
    tag.className = `status-tag ${safeStatus}`;
    tag.textContent = call.status || 'Interested';

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    // View Transcript & Summary button
    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'View Intelligence';
    viewBtn.onclick = () => openCallModal(call.id);
    actions.append(viewBtn);

    // Audio Playback Player if recording exists (stored as base64 dataURL)
    if (call.recordingDataUrl) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.className = 'history-audio';
      audio.src = call.recordingDataUrl;
      actions.append(audio);
    }

    // Delete Call button
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = 'Delete';
    delBtn.onclick = async () => {
      if (confirm(`Delete this ${call.product} call record and its recording?`)) {
        await deleteCallFromBackend(call.id);
      }
    };
    actions.append(delBtn);

    card.append(symbol, info, meta, tag, actions);
    root.append(card);
  });
}

function updateFilterCounts() {
  const getCount = (st) => calls.filter(c => c.status === st).length;
  $('count-all').textContent = calls.length;
  $('count-converted').textContent = getCount('Converted');
  $('count-interested').textContent = getCount('Interested');
  $('count-demo').textContent = getCount('Demo Requested');
  $('count-followup').textContent = getCount('Follow-up Required');
  $('count-notinterested').textContent = getCount('Not Interested');
}

async function deleteCallFromBackend(id) {
  try {
    const all = lsLoadCalls().filter(c => c.id !== id);
    lsSaveCalls(all);
    calls = all;
    renderHistory();
    renderInsights();
    renderNavCounts();
    toast('Call deleted.');
  } catch (err) {
    toast('Failed to delete call: ' + err.message, true);
  }
}

function openCallModal(id) {
  const call = calls.find(c => c.id === id);
  if (!call) return;

  currentCallId = call.id;
  // Recordings stored as base64 dataURL in the call record itself
  currentRecordingUrl = call.recordingDataUrl || null;

  if (call.summary) {
    pendingSummary = call.summary;
    renderSummaryModal(call.summary);
  } else {
    // Generate fresh summary for this call
    pendingSummary = {
      summary: `Call recorded on ${new Date(call.date).toLocaleString()} with ${call.transcript?.length || 0} turns.`,
      requirements: ['Review transcript turns for specific customer requests'],
      questionsAsked: (call.transcript || []).filter(m => m.role === 'customer' && m.text.includes('?')).map(m => m.text),
      objections: [],
      customerInterest: 'Customer engaged in conversation.',
      nextSteps: ['Follow up with customer based on transcript.'],
      status: call.status || 'Interested',
      source: 'rule_based'
    };
    renderSummaryModal(pendingSummary);
  }

  $('summary-modal').classList.remove('hidden');
}

function renderNavCounts() {
  $('history-count').textContent = calls.length;
}

// -------------------------------------------------------------
// Sales Insights & Analytics
// -------------------------------------------------------------

function renderInsights() {
  const total = calls.length;
  const getCount = (st) => calls.filter(c => c.status === st).length;

  const converted = getCount('Converted');
  const demo = getCount('Demo Requested');
  const interested = getCount('Interested');
  const followUp = getCount('Follow-up Required');

  $('insight-total').textContent = total;
  $('insight-total-sub').textContent = `${total} saved calls`;
  $('insight-interested').textContent = converted + demo + interested;
  $('insight-followup').textContent = followUp;
  $('insights-call-count').textContent = `${total} calls recorded`;

  const root = $('outcome-bars');
  if (!root) return;
  root.innerHTML = '';

  STATUS_OPTIONS.forEach(st => {
    const count = getCount(st);
    const pct = total ? Math.round((count / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'bar-row';

    const label = document.createElement('span');
    label.textContent = st;

    const track = document.createElement('div');
    track.className = 'bar-track';

    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${pct}%`;
    track.append(fill);

    const num = document.createElement('strong');
    num.textContent = count;

    row.append(label, track, num);
    root.append(row);
  });
}

// -------------------------------------------------------------
// Settings Modal & API Configuration
// -------------------------------------------------------------

function setupSettingsModal() {
  $('open-settings-btn').addEventListener('click', () => {
    $('settings-modal').classList.remove('hidden');
  });

  $('ai-status-pill').addEventListener('click', () => {
    $('settings-modal').classList.remove('hidden');
  });

  $('close-settings').addEventListener('click', () => {
    $('settings-modal').classList.add('hidden');
  });

  $('settings-modal').addEventListener('click', (e) => {
    if (e.target === $('settings-modal')) $('settings-modal').classList.add('hidden');
  });

  $('settings-voice-select').addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === 'default') {
      selectedVoice = null;
    } else {
      selectedVoice = currentVoices[parseInt(val, 10)] || null;
    }
  });

  $('save-settings-btn').addEventListener('click', async () => {
    const key = $('settings-api-key').value.trim();
    const provider = $('settings-provider').value;

    if (key) {
      try {
        const res = await fetch('/api/config/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, apiKey: key })
        });
        const data = await res.json();
        if (res.ok) {
          toast(data.message || 'API key updated.');
          $('settings-api-key').value = '';
          await loadAiConfig();
        } else {
          toast(data.error || 'Failed to update key.', true);
        }
      } catch (err) {
        toast('Connection error updating key.', true);
      }
    } else {
      toast('Settings saved.');
    }

    $('settings-modal').classList.add('hidden');
  });
}

// -------------------------------------------------------------
// DOM Event Listeners & Helpers
// -------------------------------------------------------------

function setupEventListeners() {
  $('start-btn').addEventListener('click', startCall);
  $('end-btn').addEventListener('click', endCall);

  $('mic-btn').addEventListener('click', () => {
    if (!isActive) return;
    if (isListening) pauseListening();
    else resumeListening();
  });

  // Mute / Unmute TTS voice toggle
  $('tts-btn').addEventListener('click', () => {
    isMuted = !isMuted;
    const btn = $('tts-btn');
    if (isMuted) {
      btn.textContent = '🔇';
      btn.classList.add('muted');
      btn.title = 'AI Voice muted (click to unmute)';
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      toast('AI voice muted.');
    } else {
      btn.textContent = '🔊';
      btn.classList.remove('muted');
      btn.title = 'AI Voice active (click to mute)';
      toast('AI voice unmuted.');
    }
  });

  // Text message send
  $('send-btn').addEventListener('click', () => {
    const input = $('text-input');
    const text = input.value.trim();
    if (!text || !isActive) return;
    input.value = '';
    pauseListening();
    handleCustomerMessage(text);
  });

  $('text-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('send-btn').click();
    }
  });

  // Product Selection Change
  $('product').addEventListener('change', () => {
    const selected = $('product').value;
    $('custom-product-fields').classList.toggle('hidden', selected !== 'Custom SaaS');
    updateProductPreview();
  });

  $('language').addEventListener('change', () => {
    const newLang = $('language').value;
    if (recognition) {
      recognition.lang = newLang === 'Hindi' ? 'hi-IN' : newLang === 'Telugu' ? 'te-IN' : 'en-US';
    }
  });

  // Summary Modal controls
  $('summary-btn').addEventListener('click', generateSummary);
  $('close-modal').addEventListener('click', () => $('summary-modal').classList.add('hidden'));
  $('summary-modal').addEventListener('click', (e) => {
    if (e.target === $('summary-modal')) $('summary-modal').classList.add('hidden');
  });
  $('save-summary').addEventListener('click', saveSummaryToDatabase);

  // History Filter Pills
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      renderHistory();
    });
  });

  $('history-search')?.addEventListener('input', () => {
    renderHistory();
  });

  // Export History JSON
  $('export-btn').addEventListener('click', () => {
    window.location.href = '/api/calls/export/all';
  });

  setupSettingsModal();
}

function updateProductPreview() {
  const prod = $('product').value;
  const p = productProfiles[prod] || {
    name: prod,
    category: 'Cloud SaaS',
    overview: 'Automate business workflows.',
    tagline: 'Modern software platform.'
  };

  $('product-logo').textContent = p.name.charAt(0);
  $('product-name').textContent = p.name;
  $('product-summary').textContent = p.category;
  $('product-desc').textContent = `${p.tagline} ${p.overview}`;
}

function updateTimer() {
  if (!startedAt) return;
  currentDurationSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const mins = String(Math.floor(currentDurationSeconds / 60)).padStart(2, '0');
  const secs = String(currentDurationSeconds % 60).padStart(2, '0');
  currentDurationFormatted = `${mins}:${secs}`;
  $('timer').textContent = currentDurationFormatted;
}

function clock() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toast(msg, isError = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${isError ? 'error' : ''} show`;
  setTimeout(() => el.classList.remove('show'), 3500);
}
