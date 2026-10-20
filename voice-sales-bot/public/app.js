/* ============================================================
   Voxly frontend — vanilla ES module, no build step.
   The browser never talks to the AI provider directly: every model
   call goes through /api/* on this origin.
   ============================================================ */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const state = {
  config: null,
  call: null,
  messages: [],
  inCall: false,
  starting: false,
  ending: false,
  sending: false,
  muted: false,
  productId: 'flowpilot',
  language: 'en',
  consent: false,
  recognition: null,
  recognizing: false,
  wantListening: false,
  speaking: false,
  micStream: null,
  recorder: null,
  recordChunks: [],
  recordMime: null,
  recorderAvailable: false,
  recordingActive: false,
  lastRecordingBlob: null,
  timerHandle: null,
  historyTimer: null,
  viewing: 'dialer',
  pendingSends: [],
  speechUnsupportedNotified: false,
};

const els = {
  aiPill: $('#aiPill'),
  aiPillText: $('#aiPillText'),
  navTabs: $$('.tab'),
  views: { dialer: $('#view-dialer'), history: $('#view-history'), insights: $('#view-insights') },
  connState: $('#connState'),
  connText: $('#connText'),
  callTimer: $('#callTimer'),
  stageBadge: $('#stageBadge'),
  orb: $('#orb'),
  orbCaption: $('#orbCaption'),
  stageProduct: $('#stageProduct'),
  stageAiNote: $('#stageAiNote'),
  startBtn: $('#startBtn'),
  endBtn: $('#endBtn'),
  muteBtn: $('#muteBtn'),
  muteLabel: $('#muteLabel'),
  micHelp: $('#micHelp'),
  productList: $('#productList'),
  productDesc: $('#productDesc'),
  languageGroup: $('#languageGroup'),
  consentCheck: $('#consentCheck'),
  recordingSupport: $('#recordingSupport'),
  aiProvider: $('#aiProvider'),
  aiModel: $('#aiModel'),
  aiStt: $('#aiStt'),
  aiTts: $('#aiTts'),
  aiHint: $('#aiHint'),
  chatLog: $('#chatLog'),
  chatEmpty: $('#chatEmpty'),
  interimLine: $('#interimLine'),
  textForm: $('#textForm'),
  textInput: $('#textInput'),
  sendBtn: $('#sendBtn'),
  liveIndicator: $('#liveIndicator'),
  postcallPanel: $('#postcallPanel'),
  postcallBody: $('#postcallBody'),
  outcomeBadge: $('#outcomeBadge'),
  recNote: $('#recNote'),
  recPlayer: $('#recPlayer'),
  recError: $('#recError'),
  summaryBody: $('#summaryBody'),
  regenSummaryBtn: $('#regenSummaryBtn'),
  newCallBtn: $('#newCallBtn'),
  resumeBanner: $('#resumeBanner'),
  resumeText: $('#resumeText'),
  resumeBtn: $('#resumeBtn'),
  resumeEndBtn: $('#resumeEndBtn'),
  historyStats: $('#historyStats'),
  insightStats: $('#insightStats'),
  statusFilter: $('#statusFilter'),
  searchInput: $('#searchInput'),
  historyList: $('#historyList'),
  refreshHistoryBtn: $('#refreshHistoryBtn'),
  exportBtn: $('#exportBtn'),
  statusChart: $('#statusChart'),
  recentOutcomes: $('#recentOutcomes'),
  toastRegion: $('#toastRegion'),
  footerStorage: $('#footerStorage'),
};

const LANG_META = {
  en: { label: 'English', speech: 'en-IN', speaker: 'You' },
  hi: { label: 'हिंदी', speech: 'hi-IN', speaker: 'आप' },
};

/* ---------------------------- helpers ---------------------------- */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value; // only used with static svg strings
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

class ApiError extends Error {
  constructor(message, { code = 'REQUEST_FAILED', status = 0 } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function api(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the Voxly server. Check that it is running and try again.', {
      code: 'NETWORK_ERROR',
    });
  }

  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  }
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(error?.message || `Request failed with HTTP ${response.status}.`, {
      code: error?.code || `HTTP_${response.status}`,
      status: response.status,
    });
  }
  return payload;
}

function toast(message, kind = 'info', code = '') {
  const node = el(
    'div',
    { class: 'toast', dataset: { kind }, role: kind === 'error' ? 'alert' : 'status' },
    message,
    code ? el('span', { class: 'toast-code', text: code }) : null,
  );
  els.toastRegion.append(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    node.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    setTimeout(() => node.remove(), 320);
  }, kind === 'error' ? 8000 : 4200);
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status, { className = 'status-badge' } = {}) {
  return el('span', {
    class: className,
    dataset: { status: status || 'unknown' },
    text: status || 'In progress',
  });
}

function setConn(stateName, text) {
  els.connState.dataset.state = stateName;
  els.connText.textContent = text;
}

function setOrb(mode) {
  els.orb.dataset.state = mode;
}

function setCaption(text) {
  els.orbCaption.textContent = text;
}

function setMicHelp(text, tone = '') {
  els.micHelp.textContent = text;
  if (tone) els.micHelp.dataset.tone = tone;
  else delete els.micHelp.dataset.tone;
}

function scrollChat() {
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

/* ---------------------------- config ---------------------------- */

async function loadConfig() {
  try {
    const config = await api('/api/config');
    state.config = config;
    state.productId = config.products.some((p) => p.id === state.productId)
      ? state.productId
      : config.products[0]?.id || 'flowpilot';
    renderProducts();
    renderAiStatus();
    syncSetupAvailability();
    if (config.activeCall) {
      state.activeCall = config.activeCall;
      showResume(config.activeCall);
    }
    if (config.limits?.messageMaxLength) els.textInput.maxLength = config.limits.messageMaxLength;
  } catch (error) {
    els.aiPill.dataset.state = 'error';
    els.aiPillText.textContent = 'Server unreachable';
    els.startBtn.disabled = true;
    els.stageAiNote.textContent = 'Cannot reach the Voxly backend API.';
    els.productDesc.textContent = 'Product catalogue unavailable until the server is reachable.';
    els.aiProvider.textContent = '—';
    toast(error.message, 'error', error.code);
  }
}

function renderProducts() {
  const products = state.config?.products || [];
  els.productList.replaceChildren(
    ...products.map((product) =>
      el(
        'label',
        { class: 'product-option' },
        el('input', {
          type: 'radio',
          name: 'product',
          value: product.id,
          checked: product.id === state.productId,
          onchange: () => {
            state.productId = product.id;
            updateProductDescription();
            els.stageProduct.textContent = product.name;
            updateStageNote();
          },
        }),
        el(
          'span',
          {},
          el('span', { class: 'po-name', text: product.name }),
          el('br'),
          el('span', { class: 'po-tag', text: product.tagline }),
        ),
      ),
    ),
  );
  updateProductDescription();
  const current = products.find((p) => p.id === state.productId);
  if (current) els.stageProduct.textContent = current.name;
}

function updateProductDescription() {
  const product = state.config?.products.find((p) => p.id === state.productId);
  els.productDesc.textContent = product
    ? `${product.description} Ideal for: ${product.idealCustomer}`
    : '';
}

function renderAiStatus() {
  const ai = state.config?.ai;
  const sttSupported = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const ttsSupported = 'speechSynthesis' in window;

  els.aiStt.textContent = sttSupported ? 'Browser SpeechRecognition' : 'Not supported — type instead';
  els.aiTts.textContent = ttsSupported ? 'Browser speech synthesis' : 'Not supported — read replies';

  if (ai?.configured) {
    els.aiPill.dataset.state = 'ok';
    els.aiPillText.textContent = `${ai.provider === 'gemini' ? 'Gemini' : 'OpenAI'} connected`;
    els.aiProvider.textContent = ai.provider === 'gemini' ? 'Google Gemini' : 'OpenAI';
    els.aiModel.textContent = ai.model || '—';
    els.aiHint.textContent = 'Model calls run on the server. API keys are never sent to this browser.';
  } else {
    els.aiPill.dataset.state = 'error';
    els.aiPillText.textContent = 'AI not configured';
    els.aiProvider.textContent = 'None';
    els.aiModel.textContent = '—';
    els.aiHint.textContent =
      'Set GEMINI_API_KEY (or OPENAI_API_KEY) in the server environment and restart. No simulated replies are used.';
  }
  updateStageNote();
  updateRecordingSupport();
}

function updateStageNote() {
  const ai = state.config?.ai;
  if (!ai) {
    els.stageAiNote.textContent = 'AI provider status unknown.';
    return;
  }
  els.stageAiNote.textContent = ai.configured
    ? `${ai.provider === 'gemini' ? 'Gemini' : 'OpenAI'} · ${ai.model}`
    : 'AI provider not configured on the server';
}

function updateRecordingSupport() {
  const hasRecorder = typeof window.MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  state.recorderAvailable = hasRecorder;
  if (hasRecorder) {
    const mime = pickRecorderMime();
    els.recordingSupport.textContent = mime
      ? `Recording supported (${mime}). Your microphone audio is saved and can be played back after the call.`
      : 'MediaRecorder is available but none of the supported audio formats are supported by this browser.';
  } else {
    els.recordingSupport.textContent =
      'This browser cannot record audio (MediaRecorder unavailable). Calls and transcripts still work; recordings will be skipped.';
  }
  if (!hasRecorder) {
    els.consentCheck.checked = false;
    els.consentCheck.disabled = true;
  }
}

function syncSetupAvailability() {
  const setupLocked = state.inCall || state.starting;
  $$('input[name="product"]').forEach((input) => {
    input.disabled = setupLocked;
  });
  $$('input[name="language"]').forEach((input) => {
    input.disabled = setupLocked;
  });
  els.consentCheck.disabled = setupLocked || !state.recorderAvailable;
  state.consent = els.consentCheck.checked;
  els.startBtn.disabled =
    setupLocked || state.ending || !state.config?.ai?.configured || !state.config;
}

/* ---------------------------- speech ---------------------------- */

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function speechLang() {
  return (LANG_META[state.call?.language || state.language] || LANG_META.en).speech;
}

function pickVoice(lang) {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  const exact = voices.find((v) => v.lang?.replace('_', '-').toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  const prefix = lang.slice(0, 2).toLowerCase();
  return voices.find((v) => v.lang?.toLowerCase().startsWith(prefix)) || null;
}

function stopSpeaking() {
  if ('speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  if (state.speaking) {
    state.speaking = false;
    setOrb(state.inCall ? 'live' : 'idle');
    if (state.inCall) setCaption('Listening…');
  }
}

function speak(text) {
  if (!text) return;
  if (!('speechSynthesis' in window)) {
    if (!state.speechUnsupportedNotified) {
      state.speechUnsupportedNotified = true;
      toast('Speech output is not supported in this browser. Replies are shown as text.', 'info');
    }
    return;
  }
  if (state.muted) {
    // Muted: keep listening flow, just don't voice the reply.
    if (state.inCall && state.wantListening) setTimeout(startListening, 150);
    return;
  }

  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  // Echo prevention: never transcribe our own voice.
  if (state.recognizing) {
    state.wantListening = true;
    try {
      state.recognition.abort();
    } catch {
      /* ignore */
    }
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLang();
  const voice = pickVoice(utterance.lang);
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    state.speaking = false;
    if (state.inCall) {
      setOrb('live');
      setCaption('Listening…');
      if (state.wantListening) setTimeout(startListening, 250);
    } else {
      setOrb('idle');
      setCaption('Ready when you are');
    }
  };

  state.speaking = true;
  setOrb('speaking');
  setCaption('Voxly is speaking…');
  utterance.onend = finish;
  utterance.onerror = (event) => {
    if (event?.error && !['interrupted', 'canceled'].includes(event.error)) {
      console.warn('[tts]', event.error);
    }
    finish();
  };
  try {
    synth.speak(utterance);
  } catch (error) {
    console.warn('[tts] failed', error);
    finish();
  }
}

function buildRecognition() {
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = speechLang();

  recognition.onstart = () => {
    state.recognizing = true;
    if (state.inCall && !state.speaking) {
      setOrb('listening');
      setCaption('Listening — speak now');
    }
  };

  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript || '';
      if (result.isFinal) finalText += transcript;
      else interim += transcript;
    }
    els.interimLine.textContent = interim.trim() ? `${interim.trim()}…` : '';
    if (finalText.trim()) {
      els.interimLine.textContent = '';
      const text = finalText.trim();
      if (isEcho(text)) return;
      queueSend(text);
    }
  };

  recognition.onerror = (event) => {
    const code = event?.error || 'unknown';
    if (code === 'no-speech' || code === 'aborted') return;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      state.wantListening = false;
      setMicHelp(
        'Microphone permission was blocked. Allow microphone access in your browser, or type your replies below.',
        'error',
      );
      toast('Microphone access is blocked. You can still type your replies.', 'error', 'MIC_DENIED');
      return;
    }
    if (code === 'audio-capture') {
      setMicHelp('No microphone was detected. Connect a microphone or type your replies.', 'error');
      return;
    }
    if (code === 'network') {
      setMicHelp('Speech recognition needs a network connection in this browser. You can type instead.', 'warn');
      return;
    }
    setMicHelp(`Speech recognition issue (${code}). You can type your replies.`, 'warn');
  };

  recognition.onend = () => {
    state.recognizing = false;
    if (state.inCall && state.wantListening && !state.speaking && !state.muted) {
      setTimeout(startListening, 300);
    } else if (state.inCall && !state.speaking) {
      setOrb('live');
      setCaption(state.muted ? 'Microphone muted — type if needed' : 'Listening paused');
    }
  };

  return recognition;
}

function isEcho(text) {
  const normalize = (value) => value.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const candidate = normalize(text);
  if (!candidate) return true;
  const recentAssistant = state.messages.filter((m) => m.role === 'assistant').slice(-2);
  return recentAssistant.some((message) => {
    const spoken = normalize(message.content);
    return spoken === candidate || (candidate.length > 12 && spoken.includes(candidate));
  });
}

function startListening() {
  if (!state.inCall || state.muted || state.speaking) return;
  if (!state.recognition) state.recognition = buildRecognition();
  if (!state.recognition) {
    setMicHelp('This browser does not support speech recognition. Type your replies in the box below.', 'warn');
    return;
  }
  if (state.recognizing) return;
  state.wantListening = true;
  state.recognition.lang = speechLang();
  try {
    state.recognition.start();
  } catch (error) {
    // start() throws if a session is already active; ignore that case.
    if (error?.name !== 'InvalidStateError') {
      console.warn('[stt] start failed', error);
      setMicHelp('Could not start speech recognition. You can type your replies instead.', 'warn');
    }
  }
}

function stopListening({ keepIntent = false } = {}) {
  if (!keepIntent) state.wantListening = false;
  if (!state.recognition) return;
  try {
    state.recognition.stop();
  } catch {
    /* ignore */
  }
  els.interimLine.textContent = '';
}

function toggleMute() {
  state.muted = !state.muted;
  els.muteBtn.setAttribute('aria-pressed', String(state.muted));
  els.muteLabel.textContent = state.muted ? 'Unmute mic' : 'Mute mic';
  if (state.micStream) {
    state.micStream.getAudioTracks().forEach((track) => {
      track.enabled = !state.muted;
    });
  }
  if (state.muted) {
    stopListening();
    stopSpeaking();
    setMicHelp('Microphone muted. Unmute to speak, or type your reply.', 'warn');
    setCaption('Microphone muted');
  } else {
    setMicHelp('Microphone live — speak naturally.', '');
    setOrb('live');
    startListening();
  }
}

/* ---------------------------- recording ---------------------------- */

function pickRecorderMime() {
  if (typeof window.MediaRecorder === 'undefined') return null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
  ];
  for (const mime of candidates) {
    try {
      if (window.MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* ignore */
    }
  }
  return '';
}

async function ensureMicStream() {
  if (state.micStream && state.micStream.getAudioTracks().some((t) => t.readyState === 'live')) {
    return state.micStream;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not expose microphone access (getUserMedia is unavailable).');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  state.micStream = stream;
  return stream;
}

function startRecorder(stream) {
  if (!stream || !state.config?.limits) return false;
  const mime = pickRecorderMime();
  if (mime === null) return false;
  try {
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    state.recordChunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) state.recordChunks.push(event.data);
    };
    recorder.onerror = (event) => {
      console.warn('[recorder] error', event?.error);
      toast('Audio recording stopped unexpectedly. Your transcript is still saved.', 'error', 'RECORDER_ERROR');
    };
    recorder.start(1000);
    state.recorder = recorder;
    state.recordMime = recorder.mimeType || mime || 'audio/webm';
    state.recordingActive = true;
    return true;
  } catch (error) {
    console.warn('[recorder] start failed', error);
    state.recorder = null;
    state.recordingActive = false;
    return false;
  }
}

function stopRecorder() {
  return new Promise((resolve) => {
    const recorder = state.recorder;
    if (!recorder || recorder.state === 'inactive') {
      if (state.recordChunks.length) {
        const blob = new Blob(state.recordChunks, { type: state.recordMime || 'audio/webm' });
        state.recordChunks = [];
        resolve(blob);
      } else {
        resolve(null);
      }
      return;
    }
    const finish = () => {
      state.recordingActive = false;
      const chunks = state.recordChunks;
      state.recordChunks = [];
      state.recorder = null;
      resolve(chunks.length ? new Blob(chunks, { type: state.recordMime || 'audio/webm' }) : null);
    };
    recorder.addEventListener('stop', finish, { once: true });
    try {
      recorder.stop();
    } catch {
      finish();
    }
  });
}

function releaseMic() {
  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
    state.micStream = null;
  }
}

async function uploadRecording(blob) {
  if (!blob || !state.call) return null;
  const callId = state.call.id;
  const contentType = blob.type || state.recordMime || 'audio/webm';
  const result = await api(`/api/calls/${callId}/recording`, {
    method: 'POST',
    body: blob,
    raw: true,
    headers: { 'content-type': contentType },
  });
  state.lastRecordingBlob = null;
  return result;
}

/* ---------------------------- call lifecycle ---------------------------- */

function startTimer() {
  stopTimer();
  const startedAt = state.call?.startedAt ? Date.parse(state.call.startedAt) : Date.now();
  const tick = () => {
    const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
    els.callTimer.textContent = formatDuration(seconds);
  };
  tick();
  state.timerHandle = setInterval(tick, 500);
}

function stopTimer() {
  if (state.timerHandle) clearInterval(state.timerHandle);
  state.timerHandle = null;
}

function elapsedSeconds() {
  if (!state.call?.startedAt) return 0;
  return Math.max(0, Math.round((Date.now() - Date.parse(state.call.startedAt)) / 1000));
}

function showResume(activeCall) {
  els.resumeBanner.hidden = false;
  els.resumeText.textContent = `A call for ${activeCall.productName} started at ${formatDateTime(activeCall.startedAt)} is still open.`;
  els.startBtn.disabled = true;
}

function hideResume() {
  els.resumeBanner.hidden = true;
}

function setStageEnded(call) {
  setOrb('ended');
  setCaption('Call ended');
  setConn('idle', 'Disconnected');
  setMicHelp('Call ended. Review the recording and summary on the right.', '');
  if (call?.status) {
    els.stageBadge.hidden = false;
    els.stageBadge.className = 'stage-badge';
    els.stageBadge.dataset.status = call.status;
    els.stageBadge.textContent = call.status;
  }
}

function resetStage() {
  setOrb('idle');
  setCaption('Ready when you are');
  setConn('idle', 'Not connected');
  setMicHelp('Microphone access is requested when you start the call.', '');
  els.callTimer.textContent = '00:00';
  els.stageBadge.hidden = true;
}

function setInCallUi(active) {
  els.startBtn.disabled = active;
  els.endBtn.disabled = !active;
  els.muteBtn.disabled = !active;
  els.textInput.disabled = !active;
  els.sendBtn.disabled = !active;
  els.liveIndicator.hidden = !active;
  els.textInput.placeholder = active ? 'Speak, or type your reply…' : 'Call not started — start a call to chat';
  if (!active) {
    els.muteBtn.setAttribute('aria-pressed', 'false');
    state.muted = false;
    els.muteLabel.textContent = 'Mute mic';
  }
  syncSetupAvailability();
}

async function startCall() {
  if (state.inCall || state.starting) return;
  if (!state.config?.ai?.configured) {
    toast(
      'The server has no AI key configured. Add GEMINI_API_KEY to the environment and restart the server.',
      'error',
      'AI_NOT_CONFIGURED',
    );
    return;
  }
  state.starting = true;
  els.startBtn.classList.add('is-busy');
  els.startBtn.disabled = true;
  setConn('connecting', 'Connecting…');
  setCaption('Connecting to the AI sales agent…');
  setOrb('thinking');

  let micWarning = '';
  let stream = null;
  try {
    stream = await ensureMicStream();
    setMicHelp('Microphone ready. Opening the secure channel to the AI agent…', '');
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    micWarning = denied
      ? 'Microphone permission was denied. The call will continue in text mode — type your replies below.'
      : error?.name === 'NotFoundError'
        ? 'No microphone was found. The call will continue in text mode.'
        : `Microphone unavailable (${error?.message || 'unknown error'}). The call will continue in text mode.`;
    setMicHelp(micWarning, 'warn');
  }

  try {
    const result = await api('/api/calls', {
      method: 'POST',
      body: {
        productId: state.productId,
        language: state.language,
        consentRecording: state.consent === true,
      },
    });

    state.call = result.call;
    state.activeCall = result.call;
    state.messages = result.call.messages || [];
    state.inCall = true;
    hideResume();
    renderMessages();
    setInCallUi(true);
    startTimer();
    setConn('live', 'Connected');
    setOrb('live');
    setCaption('Connected — say hello');
    els.postcallPanel.hidden = true;
    els.stageBadge.hidden = true;
    setMicHelp(
      micWarning || 'Listening — speak naturally, or type your reply below.',
      micWarning ? 'warn' : '',
    );

    const languageMeta = LANG_META[state.call.language] || LANG_META.en;
    setCaption(`Connected · ${languageMeta.label}`);

    if (state.consent) {
      if (!state.recorderAvailable) {
        toast('Recording is not supported in this browser; the call continues without audio.', 'error', 'RECORDER_UNSUPPORTED');
      } else if (!startRecorder(stream)) {
        toast('Could not start audio recording; the call continues and the transcript is still saved.', 'error', 'RECORDER_FAILED');
      }
    }

    if (result.greeting) {
      speak(result.greeting.content);
    } else if (result.greetingError) {
      addErrorMessage(result.greetingError, { retryGreeting: true });
      setOrb('error');
      setCaption('AI greeting failed');
      setMicHelp(result.greetingError.message, 'error');
      toast(result.greetingError.message, 'error', result.greetingError.code);
    }

    if (micWarning || !speechRecognitionConstructor()) {
      state.wantListening = false;
      if (!speechRecognitionConstructor()) {
        setMicHelp('Speech recognition is not supported in this browser. Type your replies below.', 'warn');
      }
    } else {
      startListening();
    }
  } catch (error) {
    state.inCall = false;
    setConn('error', 'Connection failed');
    setOrb('error');
    setCaption('Could not start the call');
    toast(error.message, 'error', error.code);
    setMicHelp(error.message, 'error');
    releaseMic();
    if (isConflict(error)) {
      await refreshActiveCall();
    }
  } finally {
    state.starting = false;
    els.startBtn.classList.remove('is-busy');
    if (!state.inCall) {
      syncSetupAvailability();
      els.startBtn.disabled = !state.config?.ai?.configured;
    }
  }
}

function isConflict(error) {
  return error?.status === 409 || error?.code === 'CONFLICT';
}

async function refreshActiveCall() {
  try {
    const { call } = await api('/api/calls/active');
    state.activeCall = call || null;
    if (call) showResume(call);
    else hideResume();
  } catch {
    /* ignore */
  }
}

async function endCall({ silent = false } = {}) {
  if (!state.inCall || state.ending) return;
  state.ending = true;
  els.endBtn.disabled = true;
  els.endBtn.classList.add('is-busy');
  stopTimer();
  stopListening();
  stopSpeaking();
  setConn('connecting', 'Ending call…');
  setCaption('Closing the call and generating the AI summary…');
  setOrb('thinking');
  els.liveIndicator.hidden = true;

  const durationSeconds = elapsedSeconds();
  els.callTimer.textContent = formatDuration(durationSeconds);

  const stopPromise = stopRecorder();
  const endPromise = api(`/api/calls/${state.call.id}/end`, {
    method: 'POST',
    body: { durationSeconds },
  });

  const [stopResult, endResult] = await Promise.allSettled([stopPromise, endPromise]);

  state.inCall = false;
  state.activeCall = null;
  setInCallUi(false);
  // Consent is per-call: require an explicit opt-in again for the next call.
  state.consent = false;
  els.consentCheck.checked = false;
  els.endBtn.classList.remove('is-busy');
  state.ending = false;
  releaseMic();

  if (endResult.status === 'rejected') {
    state.inCall = true;
    setInCallUi(true);
    setConn('error', 'Could not end call');
    setOrb('error');
    setCaption('Ending the call failed');
    els.liveIndicator.hidden = false;
    toast(endResult.reason.message, 'error', endResult.reason.code);
    setMicHelp(endResult.reason.message, 'error');
    startTimer();
    try {
      const { call } = await api(`/api/calls/${state.call.id}`);
      if (call?.endedAt) {
        state.call = call;
        finalizeOutcome(call, null, 0);
      }
    } catch {
      /* ignore */
    }
    return;
  }

  const endedCall = endResult.value.call;
  const summaryError = endResult.value.summaryError;
  state.call = endedCall;
  if (endedCall.messages) {
    state.messages = endedCall.messages;
    renderMessages();
  }
  setStageEnded(endedCall);
  finalizeOutcome(endedCall, summaryError, durationSeconds);

  const blob = stopResult.status === 'fulfilled' ? stopResult.value : null;
  if (blob) {
    state.lastRecordingBlob = blob;
    await attemptRecordingUpload(blob);
  } else if (state.call.recording?.available) {
    // e.g. a resumed call whose audio was already uploaded earlier.
    renderRecording(state.call);
  } else if (state.consent) {
    showRecordingNote('No audio was captured this call. The transcript was still saved.');
  } else {
    showRecordingNote('Recording skipped — consent was not given. The transcript was still saved.');
  }

  if (!silent) toast('Call ended. Summary and status saved to call history.', 'success', 'CALL_ENDED');
}

async function attemptRecordingUpload(blob) {
  showRecordingNote('Uploading recording…');
  els.recError.hidden = true;
  try {
    await uploadRecording(blob);
    const { call } = await api(`/api/calls/${state.call.id}`);
    state.call = call;
    renderRecording(call);
    toast('Recording saved.', 'success');
  } catch (error) {
    showRecordingNote('Recording upload failed.');
    els.recError.hidden = false;
    els.recError.replaceChildren(
      el('span', { text: `${error.message} ` }),
      el(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => attemptRecordingUpload(blob),
        },
        'Retry upload',
      ),
    );
    toast(error.message, 'error', error.code);
  }
}

function finalizeOutcome(call, summaryError, durationSeconds) {
  els.postcallPanel.hidden = false;
  els.outcomeBadge.hidden = !call.status;
  if (call.status) {
    els.outcomeBadge.className = 'status-badge';
    els.outcomeBadge.dataset.status = call.status;
    els.outcomeBadge.textContent = call.status;
  }
  els.stageProduct.textContent = call.productName;
  els.stageBadge.hidden = !call.status;
  if (call.status) {
    els.stageBadge.className = 'stage-badge';
    els.stageBadge.dataset.status = call.status;
    els.stageBadge.textContent = call.status;
  }
  els.callTimer.textContent = formatDuration(call.durationSeconds ?? durationSeconds);
  renderRecording(call);
  renderSummary(call, summaryError);
  els.regenSummaryBtn.hidden = false;
  if (window.matchMedia('(max-width: 1080px)').matches) {
    els.postcallPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function showRecordingNote(text) {
  els.recNote.textContent = text;
  els.recPlayer.hidden = true;
  els.recError.hidden = true;
}

function renderRecording(call) {
  if (call.recording?.available) {
    els.recNote.textContent = `Saved recording · ${formatBytes(call.recording.bytes)} · captured from your microphone (Voxly's synthesized voice is not in the file).`;
    els.recPlayer.hidden = false;
    els.recPlayer.src = `${call.recording.url}?v=${encodeURIComponent(call.recording.bytes + '-' + (call.endedAt || ''))}`;
    els.recError.hidden = true;
  } else if (call.consentRecording) {
    showRecordingNote('Recording is not available for this call yet.');
  } else {
    showRecordingNote('Recording skipped — consent was not given. The transcript and summary were still saved.');
  }
}

function renderSummary(call, summaryError) {
  els.summaryBody.replaceChildren();
  const summary = call.summary;
  const errorMessage = summaryError?.message || call.summaryError;

  if (summary) {
    els.summaryBody.append(
      el('p', { class: 'summary-text', text: summary.summary }),
      summaryField('Customer requirements', summary.customerRequirements),
      summaryField('Questions asked', summary.questionsAsked),
      summaryField('Objections', summary.objections),
      el(
        'div',
        { class: 'summary-field' },
        el('span', { class: 'label', text: 'Customer interest' }),
        el(
          'span',
          { class: 'interest', dataset: { level: summary.interestLevel || 'Medium' } },
          el('span', { class: 'chip', text: summary.interestLevel || 'Not assessed' }),
          el('span', { text: summary.interestReason || '' }),
        ),
      ),
      summaryField('Next steps', summary.nextSteps),
      el(
        'p',
        { class: 'hint' },
        summary.classificationSource === 'ai'
          ? `Status assigned by the AI from this transcript${summary.model ? ` (${summary.model})` : ''}.`
          : summary.classificationSource === 'rules'
            ? 'Status derived from transcript keywords because the AI classification was unavailable or unverified.'
            : 'Status derived from the stored transcript.',
      ),
    );
    if (errorMessage) {
      els.summaryBody.append(el('p', { class: 'notice' }, `Note: ${errorMessage}`));
    }
    return;
  }

  els.summaryBody.append(
    el(
      'p',
      { class: 'notice error' },
      errorMessage
        ? `AI summary could not be generated: ${errorMessage}`
        : 'No AI summary has been generated for this call yet.',
    ),
    el(
      'p',
      { class: 'hint' },
      call.status
        ? `The saved status "${call.status}" was derived from the transcript keywords, not from an AI summary.`
        : '',
    ),
  );
}

function summaryField(label, items) {
  return el(
    'div',
    { class: 'summary-field' },
    el('span', { class: 'label', text: label }),
    items && items.length
      ? el('ul', {}, ...items.map((item) => el('li', { text: item })))
      : el('span', { class: 'hint', text: 'Not mentioned in the conversation.' }),
  );
}

async function regenerateSummary() {
  if (!state.call || !state.call.endedAt) return;
  els.regenSummaryBtn.disabled = true;
  els.regenSummaryBtn.classList.add('is-busy');
  const previous = els.summaryBody.textContent;
  els.summaryBody.replaceChildren(el('p', { class: 'hint', text: 'Generating summary from the stored transcript…' }));
  try {
    const { call } = await api(`/api/calls/${state.call.id}/summary`, { method: 'POST' });
    state.call = call;
    renderSummary(call, null);
    finalizeOutcome(call, null, call.durationSeconds || 0);
    toast('Summary regenerated.', 'success');
  } catch (error) {
    els.summaryBody.replaceChildren();
    els.summaryBody.append(el('p', { class: 'notice error', text: `Summary failed: ${error.message}` }));
    if (previous) els.summaryBody.append(el('p', { class: 'hint', text: 'Previous content was not changed on the server.' }));
    toast(error.message, 'error', error.code);
  } finally {
    els.regenSummaryBtn.disabled = false;
    els.regenSummaryBtn.classList.remove('is-busy');
  }
}

async function resumeCall(callId) {
  try {
    const { call } = await api(`/api/calls/${callId}`);
    if (call.endedAt) {
      hideResume();
      toast('That call already ended. Opening its record in call history.', 'info');
      switchView('history');
      return;
    }
    state.call = call;
    state.messages = call.messages || [];
    state.inCall = true;
    state.language = call.language;
    state.productId = call.productId;
    state.consent = false;
    hideResume();
    els.postcallPanel.hidden = true;
    els.stageBadge.hidden = true;
    renderMessages();
    setInCallUi(true);
    startTimer();
    setConn('live', 'Connected (resumed)');
    setOrb('live');
    setCaption('Resumed call');
    setMicHelp('Resumed call — speech input is available, but this session is not being recorded.', 'warn');
    els.stageProduct.textContent = call.productName;
    try {
      await ensureMicStream();
      startListening();
    } catch (error) {
      setMicHelp('Microphone unavailable for the resumed call. Type your replies below.', 'warn');
    }
    switchView('dialer');
    toast('Call resumed.', 'success');
  } catch (error) {
    toast(error.message, 'error', error.code);
  }
}

async function endResumedCall(callId) {
  try {
    const result = await api(`/api/calls/${callId}/end`, { method: 'POST', body: {} });
    hideResume();
    state.activeCall = null;
    if (state.call?.id === callId) {
      state.inCall = false;
      setInCallUi(false);
      stopTimer();
      stopListening();
      releaseMic();
      state.call = result.call;
      if (result.call?.messages) {
        state.messages = result.call.messages;
        renderMessages();
      }
      setStageEnded(result.call);
      finalizeOutcome(result.call, result.summaryError || null, result.call?.durationSeconds || 0);
    }
    toast('Unfinished call closed and saved.', 'success');
    if (state.viewing === 'history') loadHistory();
  } catch (error) {
    toast(error.message, 'error', error.code);
  }
}

/* ---------------------------- messages ---------------------------- */

function addMessageNode(message) {
  if (message.role === 'customer') {
    markEmptyChat(false);
  }
  const who = message.role === 'customer' ? (LANG_META[state.call?.language || 'en'].speaker) : 'Voxly AI';
  const node = el(
    'div',
    { class: `msg ${message.role}` },
    el('span', { class: 'who', text: who }),
    el('div', { class: 'bubble', text: message.content }),
    el('span', { class: 'time', text: new Date(message.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }),
  );
  els.chatLog.append(node);
  scrollChat();
  return node;
}

function addErrorMessage(error, { retryGreeting = false } = {}) {
  const node = el(
    'div',
    { class: 'msg error' },
    el('span', { class: 'who', text: 'System' }),
    el('div', { class: 'bubble', text: `AI error: ${error.message}` }),
  );
  if (error.retryable || retryGreeting) {
    node.append(
      el(
        'button',
        {
          class: 'btn btn-ghost btn-sm retry',
          type: 'button',
          onclick: () => (retryGreeting ? retryGreetingRequest(node) : retryReply(node)),
        },
        retryGreeting ? 'Retry greeting' : 'Retry reply',
      ),
    );
  }
  els.chatLog.append(node);
  scrollChat();
}

function markEmptyChat(isEmpty) {
  const empty = els.chatEmpty;
  if (!empty) return;
  empty.hidden = !isEmpty;
}

function renderMessages() {
  els.chatLog.replaceChildren();
  if (!state.messages.length) {
    els.chatLog.append(els.chatEmpty);
    markEmptyChat(true);
    return;
  }
  markEmptyChat(false);
  for (const message of state.messages) addMessageNode(message);
}

function showTyping() {
  const node = el(
    'div',
    { class: 'msg assistant', id: 'typingIndicator' },
    el('span', { class: 'who', text: 'Voxly AI' }),
    el('div', { class: 'bubble typing', 'aria-label': 'Voxly is thinking' }, el('span'), el('span'), el('span')),
  );
  els.chatLog.append(node);
  scrollChat();
}

function hideTyping() {
  $('#typingIndicator')?.remove();
}

function queueSend(text) {
  if (state.sending) {
    state.pendingSends.push(text);
    return;
  }
  sendMessage(text);
}

async function sendMessage(text) {
  const message = String(text || '').trim();
  if (!message || !state.call || !state.inCall) return;
  if (state.sending) {
    state.pendingSends.push(message);
    return;
  }
  if (message.length > (state.config?.limits?.messageMaxLength || 2000)) {
    toast(`Message is too long (max ${state.config.limits.messageMaxLength} characters).`, 'error', 'VALIDATION');
    return;
  }

  state.sending = true;
  els.textInput.value = '';
  els.sendBtn.disabled = true;
  stopListening();
  stopSpeaking();
  setOrb('thinking');
  setCaption('Voxly is thinking…');
  markEmptyChat(false);

  const optimistic = { role: 'customer', content: message, createdAt: new Date().toISOString() };
  state.messages.push(optimistic);
  addMessageNode(optimistic);
  showTyping();

  try {
    const result = await api(`/api/calls/${state.call.id}/reply`, {
      method: 'POST',
      body: { message },
    });
    hideTyping();
    if (result.customerMessage) {
      optimistic.id = result.customerMessage.id;
    }
    if (result.assistantMessage) {
      state.messages.push(result.assistantMessage);
      addMessageNode(result.assistantMessage);
      setOrb('live');
      speak(result.assistantMessage.content);
    }
  } catch (error) {
    hideTyping();
    // The server keeps the customer turn; reflect that in local state.
    addErrorMessage({ message: error.message, retryable: true });
    setOrb('error');
    setCaption('AI reply failed');
    setMicHelp(error.message, 'error');
    toast(error.message, 'error', error.code);
    if (error.code === 'AI_NOT_CONFIGURED' || error.code === 'AI_AUTH_ERROR') {
      els.aiPill.dataset.state = 'error';
      els.aiPillText.textContent = 'AI error';
    }
  } finally {
    state.sending = false;
    els.sendBtn.disabled = !state.inCall;
    if (state.inCall && !state.speaking && !state.muted && speechRecognitionConstructor()) {
      state.wantListening = true;
      setTimeout(startListening, 300);
    }
    if (state.pendingSends.length) {
      const next = state.pendingSends.shift();
      sendMessage(next);
    }
  }
}

async function retryReply(errorNode) {
  if (!state.call) return;
  errorNode.querySelector('button')?.remove();
  showTyping();
  try {
    const result = await api(`/api/calls/${state.call.id}/retry`, { method: 'POST' });
    hideTyping();
    if (result.assistantMessage) {
      state.messages.push(result.assistantMessage);
      addMessageNode(result.assistantMessage);
      setOrb('live');
      speak(result.assistantMessage.content);
    }
  } catch (error) {
    hideTyping();
    addErrorMessage({ message: error.message, retryable: true });
    toast(error.message, 'error', error.code);
  }
}

async function retryGreetingRequest(errorNode) {
  if (!state.call) return;
  errorNode.querySelector('button')?.remove();
  try {
    const result = await api(`/api/calls/${state.call.id}/greeting`, { method: 'POST' });
    state.messages = result.call?.messages || state.messages;
    renderMessages();
    if (result.greeting) {
      state.call = result.call || state.call;
      setOrb('live');
      setCaption('Connected');
      setMicHelp('Listening — speak naturally, or type your reply below.', '');
      speak(result.greeting.content);
      startListening();
    }
  } catch (error) {
    addErrorMessage({ message: error.message, retryable: true }, { retryGreeting: true });
    toast(error.message, 'error', error.code);
  }
}

/* ---------------------------- history & insights ---------------------------- */

function statCard(label, value, sub, accent = false) {
  return el(
    'div',
    { class: `stat${accent ? ' accent' : ''}` },
    el('div', { class: 'stat-label', text: label }),
    el('div', { class: 'stat-value', text: value }),
    sub ? el('div', { class: 'stat-sub', text: sub }) : null,
  );
}

function renderStats(target, stats) {
  if (!target || !stats) return;
  target.replaceChildren(
    statCard('Total calls', String(stats.total), `${stats.inProgress} in progress`),
    statCard('Converted', String(stats.byStatus.Converted || 0), `${stats.conversionRate}% conversion`, true),
    statCard('Avg duration', formatDuration(stats.avgDurationSeconds), 'across ended calls'),
    statCard('Recordings', String(stats.recorded), 'stored on the server'),
  );
}

async function loadHistory() {
  if (!state.config) return;
  const status = els.statusFilter.value;
  const search = els.searchInput.value.trim();
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (search) params.set('search', search);
  params.set('limit', '100');
  try {
    const data = await api(`/api/calls?${params.toString()}`);
    renderStats(els.historyStats, data.stats);
    renderHistoryList(data.calls);
  } catch (error) {
    els.historyList.replaceChildren(
      el('div', { class: 'card' }, el('p', { class: 'notice error', text: `Could not load call history: ${error.message}` })),
    );
    toast(error.message, 'error', error.code);
  }
}

function shortPreview(call) {
  if (call.summary?.summary) return call.summary.summary;
  if (call.summary?.interestReason) return call.summary.interestReason;
  if (call.status) return `Saved call · status ${call.status}. Open details for the full transcript.`;
  return 'No summary available yet. Open details for the transcript.';
}

function renderHistoryList(calls) {
  if (!calls.length) {
    const isFiltered = els.statusFilter.value !== 'all' || els.searchInput.value.trim();
    els.historyList.replaceChildren(
      el(
        'div',
        { class: 'card empty' },
        el('p', { class: 'empty-title', text: isFiltered ? 'No calls match these filters' : 'No calls yet' }),
        el('p', {
          text: isFiltered
            ? 'Try clearing the search or choosing a different status.'
            : 'Start your first voice call from the Dialer — recordings, transcripts, summaries and statuses will appear here.',
        }),
        isFiltered
          ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: clearHistoryFilters, style: 'margin-top:12px' }, 'Clear filters')
          : el('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => switchView('dialer'), style: 'margin-top:12px' }, 'Go to dialer'),
      ),
    );
    return;
  }

  els.historyList.replaceChildren(
    ...calls.map((call) => {
      const lang = LANG_META[call.language]?.label || call.language;
      const detail = el('div', { class: 'call-detail', hidden: true });
      const detailsBtn = el(
        'button',
        { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-expanded': 'false' },
        'View details',
      );

      detailsBtn.addEventListener('click', async () => {
        const open = detail.hidden;
        detail.hidden = !open;
        detailsBtn.setAttribute('aria-expanded', String(open));
        detailsBtn.textContent = open ? 'Hide details' : 'View details';
        if (open && !detail.dataset.loaded) {
          detail.replaceChildren(el('p', { class: 'hint', text: 'Loading transcript…' }));
          try {
            const data = await api(`/api/calls/${call.id}`);
            renderCallDetail(detail, data.call);
            detail.dataset.loaded = 'true';
          } catch (error) {
            detail.replaceChildren(el('p', { class: 'notice error', text: `Could not load this call: ${error.message}` }));
          }
        }
      });

      const card = el(
        'article',
        { class: 'call-card', dataset: { id: call.id } },
        el(
          'div',
          { class: 'call-summary-row' },
          el(
            'div',
            { class: 'call-main' },
            el(
              'div',
              { class: 'call-title' },
              el('span', { class: 'prod', text: call.productName }),
              statusBadge(call.status),
              el('span', { class: 'lang', text: lang }),
              call.recording?.available ? el('span', { class: 'lang', text: '🎧 recorded' }) : null,
            ),
            el(
              'div',
              { class: 'call-meta' },
              el('span', { text: formatDateTime(call.startedAt) }),
              el('span', { text: call.endedAt ? formatDuration(call.durationSeconds) : 'in progress' }),
              el('span', { text: `${call.messageCount} messages` }),
            ),
            el('p', { class: 'call-peek', text: shortPreview(call) }),
          ),
          el(
            'div',
            { class: 'call-actions' },
            detailsBtn,
            call.recording?.available
              ? el(
                  'button',
                  {
                    class: 'btn btn-ghost btn-sm',
                    type: 'button',
                    onclick: () => openDetailAndPlay(detail, detailsBtn),
                  },
                  'Play',
                )
              : null,
            el(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                'aria-label': `Delete call with ${call.productName} from ${formatDateTime(call.startedAt)}`,
                onclick: () => deleteCall(call.id, card),
              },
              'Delete',
            ),
          ),
        ),
        detail,
      );
      return card;
    }),
  );
}

async function openDetailAndPlay(detail, detailsBtn) {
  if (detail.hidden) detailsBtn.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const audio = detail.querySelector('audio');
    if (audio) {
      audio.scrollIntoView({ block: 'nearest' });
      audio.focus({ preventScroll: true });
      audio.play().catch(() => {
        toast('Press play on the audio player to listen.', 'info');
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function renderCallDetail(container, call) {
  const transcript = el('div', { class: 'transcript' });
  const messages = call.messages || [];
  if (messages.length) {
    for (const message of messages) {
      transcript.append(
        el(
          'p',
          { class: `t-line ${message.role}` },
          el('span', { class: 'speaker', text: message.role === 'assistant' ? 'AI' : 'Customer' }),
          document.createTextNode(message.content),
        ),
      );
    }
  } else {
    transcript.append(el('p', { class: 'hint', text: 'No transcript was captured for this call.' }));
  }

  const recordingSection = el('div', { class: 'detail-section' }, el('h4', { text: 'Recording' }));
  if (call.recording?.available) {
    recordingSection.append(
      el('audio', { controls: true, preload: 'metadata', src: `${call.recording.url}?v=${call.recording.bytes}` }),
      el('p', { class: 'hint', text: `${formatBytes(call.recording.bytes)} · ${call.recording.mimeType || 'audio'}` }),
    );
  } else {
    recordingSection.append(
      el('p', {
        class: 'hint',
        text: call.consentRecording
          ? 'No recording stored for this call.'
          : 'Recording was skipped because consent was not given.',
      }),
    );
  }

  const summarySection = el(
    'div',
    { class: 'detail-section' },
    el('h4', { text: 'AI summary' }),
  );
  if (call.summary) {
    const block = el('div', { class: 'summary-body' });
    block.append(
      el('p', { class: 'summary-text', text: call.summary.summary }),
      summaryField('Customer requirements', call.summary.customerRequirements),
      summaryField('Questions asked', call.summary.questionsAsked),
      summaryField('Objections', call.summary.objections),
      el(
        'div',
        { class: 'summary-field' },
        el('span', { class: 'label', text: 'Customer interest' }),
        el(
          'span',
          { class: 'interest', dataset: { level: call.summary.interestLevel || 'Medium' } },
          el('span', { class: 'chip', text: call.summary.interestLevel || '—' }),
          el('span', { text: call.summary.interestReason || '' }),
        ),
      ),
      summaryField('Next steps', call.summary.nextSteps),
      el('p', {
        class: 'hint',
        text:
          call.summary.classificationSource === 'ai'
            ? 'Status assigned by AI from this transcript.'
            : 'Status derived from transcript keywords (AI classification unavailable or unverified).',
      }),
    );
    summarySection.append(block);
  } else {
    summarySection.append(
      el('p', { class: 'hint', text: call.summaryError ? `Summary unavailable: ${call.summaryError}` : 'No AI summary stored.' }),
    );
  }

  const metaSection = el(
    'div',
    { class: 'detail-section' },
    el('h4', { text: 'Call facts' }),
    el(
      'dl',
      { class: 'kv' },
      el('div', {}, el('dt', { text: 'Started' }), el('dd', { text: formatDateTime(call.startedAt) })),
      el('div', {}, el('dt', { text: 'Duration' }), el('dd', { text: formatDuration(call.durationSeconds) })),
      el('div', {}, el('dt', { text: 'Language' }), el('dd', { text: LANG_META[call.language]?.label || call.language })),
      el('div', {}, el('dt', { text: 'Product' }), el('dd', { text: call.productName })),
      el('div', {}, el('dt', { text: 'Status' }), el('dd', { text: call.status || '—' })),
      el('div', {}, el('dt', { text: 'Consent' }), el('dd', { text: call.consentRecording ? 'Given' : 'Not given' })),
      el('div', {}, el('dt', { text: 'Messages' }), el('dd', { text: String(call.messageCount) })),
    ),
  );

  container.replaceChildren(
    el(
      'div',
      { class: 'detail-grid' },
      el('div', { class: 'detail-section' }, el('h4', { text: 'Transcript' }), transcript),
      el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, recordingSection, summarySection, metaSection),
    ),
  );
}

async function deleteCall(callId, card) {
  const confirmed = window.confirm('Delete this call, its transcript, summary and recording? This cannot be undone.');
  if (!confirmed) return;
  try {
    await api(`/api/calls/${callId}`, { method: 'DELETE' });
    card.remove();
    toast('Call deleted.', 'success');
    loadHistory();
  } catch (error) {
    toast(
      error.code === 'UNAUTHORIZED'
        ? 'Deleting calls requires the admin token (ADMIN_TOKEN) configured on the server.'
        : error.message,
      'error',
      error.code,
    );
  }
}

function clearHistoryFilters() {
  els.statusFilter.value = 'all';
  els.searchInput.value = '';
  loadHistory();
}

async function loadInsights() {
  try {
    const { calls, stats } = await api('/api/calls?limit=50');
    renderStats(els.insightStats, stats);
    const max = Math.max(1, ...Object.values(stats.byStatus));
    els.statusChart.replaceChildren(
      ...Object.entries(stats.byStatus).map(([status, count]) =>
        el(
          'div',
          { class: 'chart-row' },
          el('span', { text: status }),
          el(
            'div',
            {
              class: 'chart-bar',
              role: 'img',
              'aria-label': `${status}: ${count} calls`,
            },
            el('div', { class: 'chart-fill', style: `width:${Math.round((count / max) * 100)}%` }),
          ),
          el('span', { class: 'val', text: String(count) }),
        ),
      ),
    );
    const recent = calls.filter((call) => call.status).slice(0, 8);
    els.recentOutcomes.replaceChildren(
      ...(recent.length
        ? recent.map((call) =>
            el(
              'div',
              { class: 'recent-item' },
              el('span', { text: `${call.productName} · ${formatDateTime(call.startedAt)}` }),
              el('span', { style: 'display:flex;gap:8px;align-items:center' }, statusBadge(call.status), el('span', { class: 'hint', text: formatDuration(call.durationSeconds) })),
            ),
          )
        : [el('p', { class: 'hint', text: 'No completed calls yet.' })]),
    );
  } catch (error) {
    els.statusChart.replaceChildren(el('p', { class: 'notice error', text: `Insights unavailable: ${error.message}` }));
    toast(error.message, 'error', error.code);
  }
}

async function exportCalls() {
  els.exportBtn.disabled = true;
  els.exportBtn.classList.add('is-busy');
  try {
    const response = await fetch('/api/export');
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiError(payload?.error?.message || `Export failed (HTTP ${response.status}).`, {
        code: payload?.error?.code || 'EXPORT_FAILED',
        status: response.status,
      });
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: `voxly-calls-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Call history exported.', 'success');
  } catch (error) {
    toast(
      error.code === 'UNAUTHORIZED'
        ? 'Export requires the admin token configured in ADMIN_TOKEN on the server.'
        : error.message,
      'error',
      error.code,
    );
  } finally {
    els.exportBtn.disabled = false;
    els.exportBtn.classList.remove('is-busy');
  }
}

/* ---------------------------- navigation ---------------------------- */

function switchView(view) {
  if (!els.views[view]) return;
  state.viewing = view;
  for (const [name, node] of Object.entries(els.views)) {
    const active = name === view;
    node.hidden = !active;
    node.classList.toggle('is-active', active);
  }
  els.navTabs.forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (view === 'history') loadHistory();
  if (view === 'insights') loadInsights();
  if (window.location.hash !== `#${view}`) {
    history.replaceState(null, '', `#${view}`);
  }
}

/* ---------------------------- wiring ---------------------------- */

function wire() {
  els.navTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1 };
      let nextIndex = null;
      if (event.key in keys) nextIndex = (index + keys[event.key] + els.navTabs.length) % els.navTabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = els.navTabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      els.navTabs[nextIndex].focus();
      switchView(els.navTabs[nextIndex].dataset.view);
    });
  });

  els.languageGroup.addEventListener('change', (event) => {
    if (event.target.name === 'language') {
      state.language = event.target.value;
      if (state.recognition) state.recognition.lang = LANG_META[state.language].speech;
    }
  });

  els.consentCheck.addEventListener('change', () => {
    state.consent = els.consentCheck.checked;
  });

  els.startBtn.addEventListener('click', startCall);
  els.endBtn.addEventListener('click', () => endCall());
  els.muteBtn.addEventListener('click', toggleMute);

  els.textForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.inCall) {
      if (!state.starting) toast('Start a call first — the AI only replies during a live call.', 'info');
      return;
    }
    const value = els.textInput.value.trim();
    if (!value) return;
    if (state.sending) {
      queueSend(value);
      els.textInput.value = '';
      toast('Voxly is still replying — your message will be sent next.', 'info');
      return;
    }
    sendMessage(value);
  });

  els.regenSummaryBtn.addEventListener('click', regenerateSummary);
  els.newCallBtn.addEventListener('click', () => {
    els.postcallPanel.hidden = true;
    resetStage();
    els.startBtn.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  els.resumeBtn.addEventListener('click', () => {
    const id = state.activeCall?.id;
    if (id) resumeCall(id);
    else refreshActiveCall();
  });
  els.resumeEndBtn.addEventListener('click', () => {
    const id = state.activeCall?.id;
    if (id) endResumedCall(id);
    else hideResume();
  });

  els.refreshHistoryBtn.addEventListener('click', loadHistory);
  els.exportBtn.addEventListener('click', exportCalls);
  els.statusFilter.addEventListener('change', loadHistory);
  els.searchInput.addEventListener('input', () => {
    clearTimeout(state.historyTimer);
    state.historyTimer = setTimeout(loadHistory, 320);
  });

  window.addEventListener('beforeunload', (event) => {
    if (state.inCall) {
      event.preventDefault();
      event.returnValue = 'A call is in progress. Run through the page?';
      return event.returnValue;
    }
    return undefined;
  });

  window.addEventListener('hashchange', () => {
    const view = window.location.hash.replace('#', '') || 'dialer';
    if (view !== state.viewing) switchView(view);
  });

  if ('speechSynthesis' in window) {
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      /* voice list is read lazily on each utterance */
    });
  }
}

async function init() {
  wire();
  const initial = window.location.hash.replace('#', '') || 'dialer';
  switchView(['dialer', 'history', 'insights'].includes(initial) ? initial : 'dialer');
  await loadConfig();
  state.language = $$('input[name="language"]').find((input) => input.checked)?.value || 'en';
}

init();
