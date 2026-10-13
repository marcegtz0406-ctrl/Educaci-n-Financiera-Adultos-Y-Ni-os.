// Sound Effects Synthesizer with Web Audio API (Zero dependencies)
class SoundFx {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  init() {
    try {
      if (!this.ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.ctx = new AudioContext();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {
      this.ctx = null;
    }
    return !!this.ctx;
  }

  tone(type, f1, f2, dur, vol = 0.25, delay = 0) {
    if (this.muted) return;
    if (!this.init()) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f1, now);
    if (f2 && f2 !== f1) osc.frequency.exponentialRampToValueAtTime(f2, now + dur * 0.6);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  playOpen() {
    this.tone('sine', 660, 990, 0.25, 0.2);
  }

  playStart() {
    this.tone('triangle', 523.25, 523.25, 0.12, 0.25, 0);
    this.tone('triangle', 659.25, 659.25, 0.12, 0.25, 0.12);
    this.tone('triangle', 783.99, 1046.5, 0.3, 0.3, 0.24);
  }

  playTick(urgent) {
    this.tone('square', urgent ? 1200 : 800, null, 0.06, urgent ? 0.12 : 0.06);
  }

  playAnswerIn() {
    this.tone('sine', 1320, 1320, 0.07, 0.08);
  }

  playReveal() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.28, i * 0.08));
  }

  playChampionFanfare() {
    if (this.muted) return;
    [
      { f: 392.00, t: 0, d: 0.16 },
      { f: 523.25, t: 0.16, d: 0.16 },
      { f: 659.25, t: 0.32, d: 0.16 },
      { f: 783.99, t: 0.48, d: 0.35 },
      { f: 659.25, t: 0.83, d: 0.14 },
      { f: 1046.50, t: 0.97, d: 1.2 }
    ].forEach(n => this.tone('triangle', n.f, n.f, n.d, 0.35, n.t));
  }
}

const sound = new SoundFx();

// Web Speech API Voice Synthesizer (Latin American Spanish: es-MX / es-419)
function speakIA(text, onStart, onEnd) {
  if (!('speechSynthesis' in window)) {
    alert('Tu navegador no soporta síntesis de voz Web Speech API.');
    return;
  }

  window.speechSynthesis.cancel();
  if (!text) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.98;
  utterance.pitch = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const latinVoice = voices.find(v => v.lang === 'es-MX' || v.lang === 'es-419' || v.lang.startsWith('es-MX') || v.lang.startsWith('es-419'))
                  || voices.find(v => v.lang.startsWith('es'));
  if (latinVoice) {
    utterance.voice = latinVoice;
  }

  utterance.onstart = () => { if (typeof onStart === 'function') onStart(); };
  utterance.onend = () => { if (typeof onEnd === 'function') onEnd(); };
  utterance.onerror = () => { if (typeof onEnd === 'function') onEnd(); };

  window.speechSynthesis.speak(utterance);
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

function stopSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];
// Para leer en voz alta: los niños identifican las opciones por color
const SPOKEN = ['Opción roja, triángulo', 'Opción azul, rombo', 'Opción amarilla, círculo', 'Opción verde, cuadrado'];

// Socket and State
// Si la página se abre sin el servidor de Node (doble clic en index.html, Live Server, hosting estático),
// la librería socket.io no existe. En ese caso no se rompe la página: se muestra un aviso claro.
const SERVER_AVAILABLE = typeof window.io === 'function';
const socket = SERVER_AVAILABLE
  ? io({ reconnection: true, reconnectionAttempts: Infinity })
  : { on() {}, emit() {}, connected: false };
let meta = null;              // categorías y puntos del tablero (sin respuestas)
let board = [];
let teams = {};
let phase = 'board';
let currentQuestion = null;
let currentOptions = [];
let readingAloud = false;
let answeredIds = new Set();
let finalDone = false;
let countdownTimer = null;
let deadline = 0;
let durationMs = 30000;
let lastTickSecond = null;
const buzzerUrl = `${window.location.protocol}//${window.location.host}/buzzer.html`;

// DOM Elements
const $ = (id) => document.getElementById(id);
const introModal = $('intro-modal');
const audienceButtons = document.querySelectorAll('.btn-audience-choice');
const btnAudience = $('btn-audience');
const boardGrid = $('board-grid');
const teamsContainer = $('teams-container');
const teamCount = $('team-count');
const connStatusText = $('conn-status-text');
const activeUrlText = $('active-url-text');
const toastEl = $('toast');

// Question Modal Elements
const questionModal = $('question-modal');
const modalCategory = $('modal-category');
const modalPoints = $('modal-points');
const modalQuestionText = $('modal-question-text');
const roundStatus = $('round-status');
const timerRing = $('timer-ring');
const timerNumber = $('timer-number');
const roundHeadline = $('round-headline');
const roundSubtext = $('round-subtext');
const answerCount = $('answer-count');
const answerTotal = $('answer-total');
const optionsGrid = $('options-grid');
const revealPanel = $('reveal-panel');
const modalAnswerText = $('modal-answer-text');
const fastestList = $('fastest-list');
const aiReflectionBox = $('ai-reflection-box');
const modalReflectionText = $('modal-reflection-text');
const speakingIndicator = $('speaking-indicator');

// Question Modal Buttons
const btnStartAnswering = $('btn-start-answering');
const btnReadAloud = $('btn-read-aloud');
const btnEndAnswering = $('btn-end-answering');
const btnIaReflection = $('btn-ia-reflection');
const btnCloseModal = $('btn-close-modal');

// Header Buttons
const btnShowQr = $('btn-show-qr');
const btnCopyLink = $('btn-copy-link');
const btnFinalJeopardy = $('btn-final-jeopardy');
const btnEndGame = $('btn-end-game');
const btnSoundToggle = $('btn-sound-toggle');
const btnFullscreen = $('btn-fullscreen');
const btnReset = $('btn-reset');

// QR Modal Elements
const qrModal = $('qr-modal');
const qrCodeImg = $('qr-code-img');
const qrUrlInput = $('qr-url-input');
const btnCopyQrUrl = $('btn-copy-qr-url');
const btnCloseQr = $('btn-close-qr');

// Podium Modal Elements
const podiumModal = $('podium-modal');
const podiumStage = $('podium-stage');
const otherTeamsList = $('other-teams-list');
const btnClosePodium = $('btn-close-podium');
const btnNewGame = $('btn-new-game');

const RING_LENGTH = 2 * Math.PI * 19;

// TOAST HELPER
let toastTimeout = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

// Copy Buzzer Link
function copyBuzzerLink() {
  navigator.clipboard.writeText(buzzerUrl).then(() => {
    showToast('¡Enlace móvil copiado al portapapeles!');
  }).catch(() => {
    prompt('Copia este enlace para los celulares de los alumnos:', buzzerUrl);
  });
}

btnCopyLink.addEventListener('click', copyBuzzerLink);
btnCopyQrUrl.addEventListener('click', copyBuzzerLink);
activeUrlText.addEventListener('click', copyBuzzerLink);

// MODAL INICIAL: elegir el público (niñas y niños / personas adultas)
let lastAudienceChangeAt = 0;

function gameInProgress() {
  return phase !== 'board'
    || Object.values(teams || {}).some(t => t.score > 0)
    || (board || []).some(col => col.some(Boolean));
}

function chooseAudience(id) {
  sound.init();
  if (!SERVER_AVAILABLE || !socket.connected) {
    introModal.classList.add('hidden');
    showToast('⚠️ Sin conexión con el servidor: el tablero aparecerá al conectarse.');
    return;
  }
  if (meta && meta.audience !== id && gameInProgress()
      && !confirm('Cambiar de público reinicia el tablero y los puntos de todos. ¿Continuar?')) {
    return;
  }
  introModal.classList.add('hidden');
  socket.emit('set-audience', { audience: id });
}

audienceButtons.forEach(btn => btn.addEventListener('click', () => chooseAudience(btn.dataset.audience)));

btnAudience.addEventListener('click', () => {
  if (phase === 'answering') {
    showToast('Espera a que termine la pregunta actual.');
    return;
  }
  introModal.classList.remove('hidden');
});

function updateAudienceUI() {
  if (!meta) return;
  btnAudience.textContent = `${meta.audienceIcon} Público: ${meta.audienceLabel}`;
  audienceButtons.forEach(btn => {
    const info = (meta.audiences || []).find(a => a.id === btn.dataset.audience);
    btn.classList.toggle('current', btn.dataset.audience === meta.audience);
    const small = btn.querySelector('[data-time]');
    if (info && small) {
      const desc = info.id === 'ninos' ? '6 a 12 años' : 'Vida diaria';
      small.textContent = `${desc} · ${Math.round(info.answerTimeMs / 1000)} s por pregunta`;
    }
  });
}

socket.on('audience-changed', ({ meta: m, state, changed }) => {
  meta = m;
  board = state.board;
  teams = state.teams;
  finalDone = state.finalDone;
  if (changed) {
    lastAudienceChangeAt = Date.now();
    phase = 'board';
    stopCountdown();
    stopSpeech();
    questionModal.classList.add('hidden');
  }
  updateAudienceUI();
  renderBoard();
  renderTeams();
  showToast(changed
    ? `${meta.audienceIcon} Público: ${meta.audienceLabel}. ¡Tablero nuevo, selecciona una pregunta!`
    : `¡Producción iniciada! ${meta.audienceIcon} ${meta.audienceLabel}. Selecciona una pregunta.`);
});

// Aviso cuando no hay servidor
const serverWarning = $('server-warning');
function setServerWarning(visible) {
  if (serverWarning) serverWarning.classList.toggle('hidden', !visible);
  connStatusText.parentElement.classList.toggle('offline', visible);
}

if (!SERVER_AVAILABLE) {
  connStatusText.textContent = 'Sin servidor: abre el juego con "node server.js" (ver aviso)';
  activeUrlText.textContent = 'No disponible sin servidor';
  setServerWarning(true);
  boardGrid.innerHTML = '<div class="board-offline">⚠️ El tablero necesita el servidor del juego.<br>Ejecuta <code>npm install</code> y <code>node server.js</code>, y abre <strong>http://localhost:3000</strong> (o tu enlace de Render).</div>';
}

function generateDynamicQr() {
  activeUrlText.textContent = buzzerUrl;
  qrUrlInput.value = buzzerUrl;
  fetch(`/api/qr?url=${encodeURIComponent(buzzerUrl)}`)
    .then(res => res.json())
    .then(data => {
      if (data.qrCodeDataUrl) qrCodeImg.src = data.qrCodeDataUrl;
    })
    .catch(() => {
      qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(buzzerUrl)}`;
    });
}

// ===== Socket connection =====
socket.on('connect', () => {
  setServerWarning(false);
  connStatusText.textContent = 'En línea (Servidor activo)';
  socket.emit('join-host');
  generateDynamicQr();
});

socket.on('disconnect', () => {
  connStatusText.textContent = 'Reconectando con el servidor...';
  connStatusText.parentElement.classList.add('offline');
});

socket.on('connect_error', () => {
  connStatusText.textContent = 'No se puede conectar con el servidor. Reintentando...';
  connStatusText.parentElement.classList.add('offline');
});

socket.on('init-host', ({ meta: m, state }) => {
  meta = m;
  updateAudienceUI();
  board = state.board;
  teams = state.teams;
  finalDone = state.finalDone;
  renderBoard();
  renderTeams();

  // Si se recargó la página a mitad de una pregunta, restaurarla
  if (state.phase !== 'board' && state.question) {
    introModal.classList.add('hidden'); // partida en curso: no volver a mostrar las reglas
    showQuestion({ ...state.question, opciones: state.opciones });
    if (state.phase === 'answering') {
      beginAnswering(state.opciones, state.remainingMs, state.question.answerTimeMs, state.progress, false);
    } else if (state.phase === 'reveal' && state.lastReveal) {
      renderOptions(state.lastReveal.opciones);
      showReveal(state.lastReveal, false);
    }
  } else {
    questionModal.classList.add('hidden');
  }
});

socket.on('teams-updated', (t) => {
  teams = t;
  renderTeams();
});

// ===== Board =====
function renderBoard() {
  if (!meta) return;
  boardGrid.innerHTML = '';

  meta.categorias.forEach((cat, catIdx) => {
    const col = document.createElement('div');
    col.className = 'category-column';

    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `<h2>${escapeHtml(cat.nombre)}</h2>`;
    col.appendChild(header);

    cat.puntos.forEach((pts, qIdx) => {
      const card = document.createElement('div');
      card.className = 'question-card';
      if (board?.[catIdx]?.[qIdx]) card.classList.add('answered');
      card.innerHTML = `<span class="points">$${escapeHtml(pts)}</span>`;
      card.addEventListener('click', () => {
        if (!card.classList.contains('answered')) openQuestion(catIdx, qIdx);
      });
      col.appendChild(card);
    });

    boardGrid.appendChild(col);
  });

  btnFinalJeopardy.disabled = !meta.hasFinal || finalDone;
}

function openQuestion(catIdx, qIdx) {
  sound.init();
  stopSpeech();
  socket.emit('open-question', { catIndex: catIdx, qIndex: qIdx });
}

// ===== Question flow =====
socket.on('question-opened', (q) => {
  sound.playOpen();
  showQuestion(q);
});

function showQuestion(q) {
  currentQuestion = q;
  phase = 'preview';
  answeredIds = new Set();
  stopCountdown();
  stopSpeech();
  readingAloud = false;
  setReadAloudLabel();

  modalCategory.textContent = q.isFinal ? `🏆 RONDA DEFINITIVA · ${q.categoria}` : q.categoria;
  modalPoints.textContent = `Hasta ${q.maxPoints} pts`;
  modalQuestionText.textContent = q.pregunta;
  durationMs = q.answerTimeMs || 30000;

  optionsGrid.innerHTML = '';
  optionsGrid.className = 'options-grid hidden';
  currentOptions = q.opciones || [];
  if (currentOptions.length) {
    renderOptions(currentOptions, true);
    optionsGrid.classList.add('waiting');
  }
  revealPanel.classList.add('hidden');
  aiReflectionBox.classList.add('hidden');
  speakingIndicator.classList.add('hidden');
  modalReflectionText.textContent = '';

  roundStatus.className = 'round-status state-preview';
  setTimerDisplay(durationMs, durationMs);
  roundHeadline.textContent = 'Lean y escuchen la pregunta';
  roundSubtext.textContent = 'Usa "🔊 Leer en voz alta". Cuando estén listos, presiona "Iniciar" y los celulares se desbloquean.';
  updateCounter(0, connectedCount());

  btnStartAnswering.innerHTML = `▶️ Iniciar (${Math.round(durationMs / 1000)} s) <span class="hotkey">[Espacio]</span>`;
  btnStartAnswering.disabled = false;
  btnEndAnswering.disabled = true;
  btnIaReflection.disabled = true;

  renderTeams();
  questionModal.classList.remove('hidden');
}

btnStartAnswering.addEventListener('click', () => {
  if (phase !== 'preview') return;
  sound.init();
  // No se detiene la lectura en voz alta: puede seguir mientras corre el tiempo
  socket.emit('start-answering');
});

// BOTÓN "🔊 Leer en voz alta": lee la pregunta y las 4 opciones (por color) para quienes aún no leen bien
function questionSpeechText() {
  if (!currentQuestion) return '';
  const parts = [currentQuestion.pregunta];
  currentOptions.forEach((texto, i) => parts.push(`${SPOKEN[i]}: ${texto}`));
  return parts.join('. ').replace(/\.\./g, '.');
}

function setReadAloudLabel() {
  btnReadAloud.innerHTML = readingAloud
    ? '⏹️ Detener lectura <span class="hotkey">[L]</span>'
    : '🔊 Leer en voz alta <span class="hotkey">[L]</span>';
}

btnReadAloud.addEventListener('click', () => {
  if (readingAloud) {
    stopSpeech();
    readingAloud = false;
    setReadAloudLabel();
    return;
  }
  const text = questionSpeechText();
  if (!text) return;
  readingAloud = true;
  setReadAloudLabel();
  speakIA(text, null, () => {
    readingAloud = false;
    setReadAloudLabel();
  });
});

socket.on('answering-started', (data) => {
  sound.playStart();
  beginAnswering(data.opciones, data.remainingMs, data.durationMs, data.progress, true);
});

function beginAnswering(opciones, remaining, duration, progress, animate) {
  phase = 'answering';
  durationMs = duration || durationMs;
  if (!optionsGrid.children.length || opciones.some((t, i) => currentOptions[i] !== t)) {
    renderOptions(opciones, animate);
  }
  currentOptions = opciones;
  optionsGrid.classList.remove('waiting');
  roundStatus.className = 'round-status state-answering';
  roundHeadline.textContent = '¡Respondan en sus celulares!';
  roundSubtext.textContent = 'Si aciertan, entre más rápido respondan, más puntos ganan.';
  btnStartAnswering.disabled = true;
  btnEndAnswering.disabled = false;
  btnIaReflection.disabled = true;
  if (progress) applyProgress(progress);
  startCountdown(remaining);
}

function renderOptions(opciones, animate = true) {
  optionsGrid.innerHTML = '';
  opciones.forEach((texto, i) => {
    const card = document.createElement('div');
    card.className = `option-card opt-${i}`;
    if (animate) card.style.animationDelay = `${i * 70}ms`;
    card.innerHTML = `
      <span class="option-shape" aria-label="Opción ${LETTERS[i]}">${SHAPES[i]}</span>
      <span class="option-text">${escapeHtml(texto)}</span>
      <span class="option-check">✓</span>
      <span class="option-count">0</span>
      <span class="option-bar"></span>
    `;
    optionsGrid.appendChild(card);
  });
  optionsGrid.className = 'options-grid';
}

function startCountdown(remaining) {
  stopCountdown();
  deadline = performance.now() + remaining;
  lastTickSecond = null;
  const step = () => {
    const left = Math.max(0, deadline - performance.now());
    setTimerDisplay(left, durationMs);
    const sec = Math.ceil(left / 1000);
    if (sec !== lastTickSecond && sec > 0 && sec <= 5) {
      sound.playTick(true);
      roundStatus.className = 'round-status state-hurry';
    }
    lastTickSecond = sec;
    if (left > 0 && phase === 'answering') {
      countdownTimer = requestAnimationFrame(step);
    }
  };
  countdownTimer = requestAnimationFrame(step);
}

function stopCountdown() {
  if (countdownTimer) cancelAnimationFrame(countdownTimer);
  countdownTimer = null;
}

function setTimerDisplay(left, total) {
  timerNumber.textContent = Math.ceil(left / 1000);
  const ratio = total > 0 ? left / total : 0;
  timerRing.style.strokeDashoffset = String(RING_LENGTH * (1 - ratio));
}

function connectedCount() {
  return Object.values(teams).filter(t => t.connected).length;
}

function updateCounter(answered, total) {
  answerCount.textContent = answered;
  answerTotal.textContent = total;
}

function applyProgress(progress) {
  const before = answeredIds.size;
  answeredIds = new Set(progress.answeredIds || []);
  updateCounter(progress.answered, progress.total);
  if (answeredIds.size > before && phase === 'answering') sound.playAnswerIn();
  renderTeams();
}

socket.on('answer-progress', (progress) => {
  if (phase !== 'answering') return;
  applyProgress(progress);
});

btnEndAnswering.addEventListener('click', () => {
  if (phase !== 'answering') return;
  socket.emit('end-answering');
});

socket.on('question-revealed', (data) => {
  teams = data.teams;
  board = data.board;
  finalDone = data.finalDone;
  if (!optionsGrid.children.length) renderOptions(data.opciones, false);
  sound.playReveal();
  showReveal(data, true);
  renderBoard();
});

function showReveal(data, animate) {
  phase = 'reveal';
  stopCountdown();
  setTimerDisplay(0, durationMs);
  answeredIds = new Set();

  const maxCount = Math.max(1, ...data.counts);
  [...optionsGrid.children].forEach((card, i) => {
    const isCorrect = i === data.correctIndex;
    card.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    card.querySelector('.option-count').textContent = data.counts[i] || 0;
    const bar = card.querySelector('.option-bar');
    const width = `${((data.counts[i] || 0) / maxCount) * 100}%`;
    if (animate) {
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = width; }));
    } else {
      bar.style.width = width;
    }
  });
  optionsGrid.classList.add('revealed');

  roundStatus.className = 'round-status state-reveal';
  roundHeadline.textContent = `Respuesta correcta: ${SHAPES[data.correctIndex]} ${LETTERS[data.correctIndex]}`;
  roundSubtext.textContent = data.totalAnswered === 0
    ? 'Nadie respondió esta pregunta.'
    : `${data.totalCorrect} de ${data.totalPlayers} acertaron · ${data.totalAnswered} respondieron.`;
  updateCounter(data.totalAnswered, data.totalPlayers);

  modalAnswerText.textContent = data.respuesta || '';
  modalReflectionText.textContent = data.reflexion_ia || '';

  const winners = data.results.filter(r => r.correct).slice(0, 5);
  fastestList.innerHTML = winners.length
    ? winners.map(r => `
        <li>
          <span class="mini-avatar" style="background:${escapeHtml(r.color)}">${escapeHtml(r.name.substring(0, 2).toUpperCase())}</span>
          <span class="f-name" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>
          <span class="f-time">${(r.elapsedMs / 1000).toFixed(1)} s</span>
          <span class="f-points">+${r.points}</span>
        </li>`).join('')
    : '<li class="fastest-empty">Nadie acertó esta vez.</li>';
  revealPanel.classList.remove('hidden');

  btnStartAnswering.disabled = true;
  btnEndAnswering.disabled = true;
  btnIaReflection.disabled = !data.reflexion_ia;
  renderTeams();
}

// BOTÓN "🤖 Reflexión IA": Reproduce en voz alta con Web Speech API (voz en español latino)
btnIaReflection.addEventListener('click', () => {
  const text = modalReflectionText.textContent;
  if (!text) return;
  aiReflectionBox.classList.remove('hidden');
  speakingIndicator.classList.remove('hidden');
  readingAloud = false;
  setReadAloudLabel();
  speakIA(text, () => {
    speakingIndicator.classList.remove('hidden');
  }, () => {
    speakingIndicator.classList.add('hidden');
  });
});

// BOTÓN "Volver al Tablero"
btnCloseModal.addEventListener('click', () => {
  if (phase === 'answering' && !confirm('La pregunta sigue abierta. Si vuelves al tablero ahora, nadie gana puntos y la casilla queda disponible. ¿Continuar?')) {
    return;
  }
  stopSpeech();
  socket.emit('close-question');
});

socket.on('question-closed', (data) => {
  readingAloud = false;
  setReadAloudLabel();
  board = data.board;
  finalDone = data.finalDone;
  phase = 'board';
  currentQuestion = null;
  answeredIds = new Set();
  stopCountdown();
  stopSpeech();
  questionModal.classList.add('hidden');
  renderBoard();
  renderTeams();
});

// ===== Scoreboard =====
function renderTeams() {
  const list = Object.values(teams || {});
  teamCount.textContent = list.length;

  if (list.length === 0) {
    teamsContainer.innerHTML = '<div class="empty-teams-msg">Esperando a que los participantes escaneen el código QR...</div>';
    return;
  }

  list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  teamsContainer.innerHTML = '';
  list.forEach((t, idx) => {
    const card = document.createElement('div');
    card.className = 'team-card';
    if (phase === 'answering' && answeredIds.has(t.id)) card.classList.add('has-answered');
    if (!t.connected) card.classList.add('disconnected');
    card.id = `team-card-${t.id}`;
    const gain = phase === 'reveal' && t.lastGain > 0 ? `<span class="team-gain">+${t.lastGain}</span>` : '';
    card.innerHTML = `
      <span class="team-rank">${idx + 1}</span>
      <div class="team-avatar" style="background: ${escapeHtml(t.color)}">
        ${escapeHtml(t.name.substring(0, 2).toUpperCase())}
      </div>
      <div class="team-info">
        <div class="team-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</div>
        <div class="team-score">${t.score}</div>
      </div>
      ${gain}
    `;
    teamsContainer.appendChild(card);
  });
}

// QR Modal
btnShowQr.addEventListener('click', () => {
  generateDynamicQr();
  qrModal.classList.remove('hidden');
});
btnCloseQr.addEventListener('click', () => {
  qrModal.classList.add('hidden');
});

// Final round: same 4-option mechanic, up to 500 pts
btnFinalJeopardy.addEventListener('click', () => {
  if (phase === 'answering') {
    showToast('Espera a que termine la pregunta actual.');
    return;
  }
  if (confirm('¿Deseas iniciar la ronda de FINAL JEOPARDY: El Corte Final? (hasta 500 pts)')) {
    stopSpeech();
    sound.init();
    socket.emit('start-final-jeopardy');
  }
});

// Reset Game
btnReset.addEventListener('click', () => {
  if (confirm('¿Estás seguro de reiniciar los puntajes y el tablero?')) {
    stopSpeech();
    socket.emit('reset-game');
  }
});

socket.on('game-reset', (data) => {
  board = data.board;
  teams = data.teams;
  finalDone = false;
  phase = 'board';
  stopCountdown();
  questionModal.classList.add('hidden');
  renderTeams();
  renderBoard();
  if (Date.now() - lastAudienceChangeAt > 1500) showToast('Partida reiniciada.');
});

// Sound Toggle & Fullscreen
btnSoundToggle.addEventListener('click', () => {
  sound.muted = !sound.muted;
  btnSoundToggle.textContent = sound.muted ? '🔇' : '🔊';
  showToast(sound.muted ? 'Sonido silenciado' : 'Sonido activado');
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  if (questionModal.classList.contains('hidden')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    btnStartAnswering.click();
  } else if (e.code === 'Escape') {
    btnCloseModal.click();
  } else if (e.code === 'KeyL') {
    btnReadAloud.click();
  }
});

// Confetti Particle System for Podium
let confettiAnimationId = null;
function startConfetti() {
  const canvas = $('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const pieces = [];
  const colors = ['#ffd700', '#ff4d4d', '#00e676', '#00b0ff', '#e040fb', '#ffffff', '#ff9100'];

  for (let i = 0; i < 170; i++) {
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      size: Math.random() * 11 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 3.5 + 2.5,
      speedX: Math.random() * 2.5 - 1.25,
      rotation: Math.random() * 360,
      rotSpeed: Math.random() * 8 - 4
    });
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.rotation += p.rotSpeed;
      if (p.y > canvas.height) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });
    confettiAnimationId = requestAnimationFrame(loop);
  }
  loop();
}

function stopConfetti() {
  if (confettiAnimationId) {
    cancelAnimationFrame(confettiAnimationId);
    confettiAnimationId = null;
  }
  const canvas = $('confetti-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// Podium Modal
btnEndGame.addEventListener('click', () => {
  if (confirm('¿Deseas finalizar la partida y coronar al ganador en el podio olímpico?')) {
    stopSpeech();
    socket.emit('end-game');
  }
});

socket.on('game-ended', ({ ranking }) => {
  if (!ranking || ranking.length === 0) {
    alert('No hay participantes registrados para mostrar el podio.');
    return;
  }

  sound.playChampionFanfare();
  startConfetti();

  podiumStage.innerHTML = '';
  ranking.slice(0, 3).forEach(t => {
    const pillar = document.createElement('div');
    pillar.className = `podium-pillar pillar-${t.rank}`;
    const medal = t.rank === 1 ? '🥇' : (t.rank === 2 ? '🥈' : '🥉');
    pillar.innerHTML = `
      <div class="podium-team-badge">
        <div class="podium-avatar" style="background: ${escapeHtml(t.color)}">${escapeHtml(t.name.substring(0, 2).toUpperCase())}</div>
        <div class="podium-name" title="${escapeHtml(t.name)}">${medal} ${escapeHtml(t.name)}</div>
        <div class="podium-score">${t.score} pts</div>
      </div>
      <div class="pillar-block">
        <span class="rank-number">#${t.rank}</span>
      </div>
    `;
    podiumStage.appendChild(pillar);
  });

  otherTeamsList.innerHTML = '';
  ranking.slice(3).forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'other-team-chip';
    chip.innerHTML = `<span>#${t.rank}</span> <span>${escapeHtml(t.name)}:</span> <strong>${t.score} pts</strong>`;
    otherTeamsList.appendChild(chip);
  });

  podiumModal.classList.remove('hidden');
});

btnClosePodium.addEventListener('click', () => {
  stopConfetti();
  podiumModal.classList.add('hidden');
});

btnNewGame.addEventListener('click', () => {
  stopConfetti();
  podiumModal.classList.add('hidden');
  socket.emit('reset-game');
});
