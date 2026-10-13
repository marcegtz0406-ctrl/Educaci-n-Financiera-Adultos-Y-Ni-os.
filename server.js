const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// ===== Reglas del juego (estilo Kahoot) =====
// Públicos: cada uno tiene su banco de preguntas (carpeta preguntas/) y su tiempo para responder.
// La variable de entorno ANSWER_TIME_MS, si existe, reemplaza el tiempo de ambos públicos.
const AUDIENCES = {
  ninos: { label: 'Niñas y niños', icon: '👧🧒', file: 'ninos.json', answerTimeMs: 40000 },
  adultos: { label: 'Personas adultas', icon: '🧑', file: 'adultos.json', answerTimeMs: 30000 }
};
const DEFAULT_AUDIENCE = 'ninos';
// Quien acierta al instante gana el 100% del valor; quien acierta al final del tiempo, el 50%.
const MIN_POINTS_RATIO = 0.5;
// Valor máximo de la ronda final
const FINAL_POINTS = 500;

// Bancos de preguntas (fuera de /public para que nadie pueda ver las respuestas)
const banks = {};
Object.entries(AUDIENCES).forEach(([id, a]) => {
  banks[id] = JSON.parse(fs.readFileSync(path.join(__dirname, 'preguntas', a.file), 'utf8'));
});
let audience = DEFAULT_AUDIENCE;
let questionsData = banks[audience];

function answerTime() {
  return Number(process.env.ANSWER_TIME_MS) || AUDIENCES[audience].answerTimeMs;
}

// Global Game State
// Clave privada de cada celular (no se envía a nadie)
const playerKeys = {};

const gameState = {
  teams: {},
  board: [],
  phase: 'board',        // 'board' | 'preview' | 'answering' | 'reveal'
  current: null,         // pregunta abierta (incluye la respuesta correcta; nunca se envía completa antes de revelar)
  answers: {},           // teamId -> { choice, elapsedMs, correct, points }
  startedAt: null,
  timer: null,
  lastReveal: null,
  finalDone: false
};

function initBoard() {
  clearAnswerTimer();
  gameState.board = questionsData.categorias.map(cat => cat.preguntas.map(() => false));
  gameState.phase = 'board';
  gameState.current = null;
  gameState.answers = {};
  gameState.startedAt = null;
  gameState.lastReveal = null;
  gameState.finalDone = false;
}

function clearAnswerTimer() {
  if (gameState.timer) {
    clearTimeout(gameState.timer);
    gameState.timer = null;
  }
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Arma las 4 opciones: opcion_branch_b es la correcta; opcion_branch_a + distractores son incorrectas.
function buildOptions(q) {
  const entries = [{ text: q.opcion_branch_b, correct: true }];
  if (q.opcion_branch_a) entries.push({ text: q.opcion_branch_a, correct: false });
  (q.distractores || []).forEach(t => { if (t) entries.push({ text: t, correct: false }); });
  const mixed = shuffle(entries.slice(0, 4));
  return {
    opciones: mixed.map(e => e.text),
    correctIndex: mixed.findIndex(e => e.correct)
  };
}

initBoard();

// Datos públicos de la pregunta (sin la respuesta correcta)
function publicQuestion() {
  const c = gameState.current;
  if (!c) return null;
  return {
    catIndex: c.catIndex,
    qIndex: c.qIndex,
    isFinal: c.isFinal,
    categoria: c.categoria,
    puntos: c.puntos,
    maxPoints: c.maxPoints,
    pregunta: c.pregunta,
    numOpciones: c.opciones.length,
    answerTimeMs: answerTime()
  };
}

function connectedTeamIds() {
  return Object.keys(gameState.teams).filter(id => gameState.teams[id].connected);
}

function answerProgress() {
  const answeredIds = Object.keys(gameState.answers);
  const pending = connectedTeamIds().filter(id => !gameState.answers[id]);
  return {
    answered: answeredIds.length,
    total: answeredIds.length + pending.length,
    answeredIds
  };
}

function remainingMs() {
  if (gameState.phase !== 'answering' || !gameState.startedAt) return 0;
  return Math.max(0, (gameState.durationMs || answerTime()) - (Date.now() - gameState.startedAt));
}

function boardMeta() {
  return {
    titulo: questionsData.titulo,
    subtitulo: questionsData.subtitulo,
    categorias: questionsData.categorias.map(cat => ({
      nombre: cat.nombre,
      puntos: cat.preguntas.map(q => q.puntos)
    })),
    hasFinal: !!questionsData.final_jeopardy,
    audience,
    audienceLabel: AUDIENCES[audience].label,
    audienceIcon: AUDIENCES[audience].icon,
    answerTimeMs: answerTime(),
    audiences: Object.entries(AUDIENCES).map(([id, a]) => ({
      id, label: a.label, icon: a.icon,
      answerTimeMs: Number(process.env.ANSWER_TIME_MS) || a.answerTimeMs
    }))
  };
}

function snapshot() {
  return {
    teams: gameState.teams,
    board: gameState.board,
    phase: gameState.phase,
    question: publicQuestion(),
    opciones: gameState.phase !== 'board' && gameState.current ? gameState.current.opciones : null,
    remainingMs: remainingMs(),
    progress: answerProgress(),
    lastReveal: gameState.phase === 'reveal' ? gameState.lastReveal : null,
    finalDone: gameState.finalDone
  };
}

function openQuestion(q, meta) {
  clearAnswerTimer();
  const { opciones, correctIndex } = buildOptions(q);
  gameState.current = {
    ...meta,
    pregunta: q.pregunta,
    opciones,
    correctIndex,
    respuesta: q.respuesta || q.respuesta_esperada || '',
    reflexion_ia: q.reflexion_ia || ''
  };
  gameState.phase = 'preview';
  gameState.answers = {};
  gameState.startedAt = null;
  gameState.lastReveal = null;
  Object.values(gameState.teams).forEach(t => { t.lastGain = 0; });
  // Las opciones se muestran desde el inicio (bloqueadas) para que se puedan leer en voz alta
  io.emit('question-opened', { ...publicQuestion(), opciones });
}

function startAnswering() {
  if (gameState.phase !== 'preview' || !gameState.current) return;
  gameState.phase = 'answering';
  gameState.startedAt = Date.now();
  gameState.answers = {};
  // Pequeño margen para la latencia de la red
  gameState.durationMs = answerTime();
  gameState.timer = setTimeout(revealAnswer, gameState.durationMs + 400);
  io.emit('answering-started', {
    opciones: gameState.current.opciones,
    durationMs: gameState.durationMs,
    remainingMs: gameState.durationMs,
    progress: answerProgress()
  });
}

function revealAnswer() {
  if (gameState.phase !== 'answering' || !gameState.current) return;
  clearAnswerTimer();
  gameState.phase = 'reveal';
  const c = gameState.current;

  const counts = c.opciones.map(() => 0);
  const results = [];
  Object.entries(gameState.answers).forEach(([teamId, a]) => {
    counts[a.choice] += 1;
    const team = gameState.teams[teamId];
    if (!team) return;
    team.score += a.points;
    team.lastGain = a.points;
    results.push({
      teamId,
      name: team.name,
      color: team.color,
      choice: a.choice,
      correct: a.correct,
      points: a.points,
      elapsedMs: a.elapsedMs
    });
  });
  results.sort((x, y) => (y.points - x.points) || (x.elapsedMs - y.elapsedMs));

  if (c.isFinal) {
    gameState.finalDone = true;
  } else if (gameState.board[c.catIndex]) {
    gameState.board[c.catIndex][c.qIndex] = true;
  }

  const progress = answerProgress();
  gameState.lastReveal = {
    correctIndex: c.correctIndex,
    opciones: c.opciones,
    counts,
    results,
    totalPlayers: progress.total,
    totalAnswered: progress.answered,
    totalCorrect: results.filter(r => r.correct).length,
    respuesta: c.respuesta,
    reflexion_ia: c.reflexion_ia,
    maxPoints: c.maxPoints,
    isFinal: c.isFinal
  };

  io.emit('question-revealed', {
    ...gameState.lastReveal,
    teams: gameState.teams,
    board: gameState.board,
    finalDone: gameState.finalDone
  });
  console.log(`[✓] Pregunta revelada: ${results.filter(r => r.correct).length}/${progress.total} aciertos.`);
}

function maybeRevealEarly() {
  if (gameState.phase !== 'answering') return;
  const progress = answerProgress();
  if (progress.total > 0 && progress.answered >= progress.total) {
    // Todos respondieron: revelar enseguida
    setTimeout(revealAnswer, 600);
  }
}

// Middleware
app.use(express.json());

// El archivo de preguntas contiene las respuestas: no se sirve a los navegadores.
app.get(['/preguntas.json', '/api/questions'], (req, res) => {
  res.status(404).end();
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Explicit route endpoints
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/buzzer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buzzer.html'));
});

app.get('/buzzer.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buzzer.html'));
});

app.get('/api/state', (req, res) => {
  res.json({
    teams: gameState.teams,
    board: gameState.board,
    phase: gameState.phase,
    question: publicQuestion()
  });
});

// Dynamic QR code API endpoint
app.get('/api/qr', async (req, res) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const targetUrl = req.query.url || `${protocol}://${host}/buzzer.html`;
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 2,
      width: 320,
      color: {
        dark: '#0a192f',
        light: '#ffffff'
      }
    });
    res.json({ url: targetUrl, qrCodeDataUrl: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Error generating QR code', details: err.message });
  }
});

// Helper to register / reconnect team
function handleRegisterTeam(socket, teamName, playerKey) {
  const cleanName = (teamName || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!cleanName) return;
  const key = typeof playerKey === 'string' ? playerKey.slice(0, 64) : '';

  const existingId = Object.keys(gameState.teams).find(
    id => gameState.teams[id].name.toLowerCase() === cleanName.toLowerCase()
  );

  // Cada quien juega con su celular: si el nombre ya lo usa OTRO celular conectado, se pide otro nombre.
  // El mismo celular (misma clave) sí puede volver a entrar y conserva sus puntos.
  if (existingId) {
    const existing = gameState.teams[existingId];
    const sameDevice = key && playerKeys[existingId] === key;
    if (existing.connected && !sameDevice) {
      socket.emit('join-error', {
        message: `El nombre "${cleanName}" ya lo está usando otra persona. Agrega tu apellido, una inicial o un número (por ejemplo: ${cleanName} 2).`
      });
      return;
    }
  }

  const teamId = existingId || socket.id;
  if (!gameState.teams[teamId]) {
    const colors = [
      '#e63946', '#2a9d8f', '#e76f51', '#457b9d',
      '#9b5de5', '#00bbf9', '#f15bb5', '#fee440',
      '#10b981', '#f97316'
    ];
    const colorIndex = Object.keys(gameState.teams).length % colors.length;
    gameState.teams[teamId] = {
      id: teamId,
      name: cleanName,
      score: 0,
      lastGain: 0,
      color: colors[colorIndex],
      connected: true
    };
    if (key) playerKeys[teamId] = key;
  } else {
    gameState.teams[teamId].connected = true;
    gameState.teams[teamId].name = cleanName;
    if (key) playerKeys[teamId] = key;
  }

  socket.teamId = teamId;
  socket.join('team-' + teamId);

  const snap = snapshot();
  socket.emit('team-registered', {
    team: gameState.teams[teamId],
    state: {
      phase: snap.phase,
      question: snap.question,
      opciones: snap.opciones,
      remainingMs: snap.remainingMs,
      myAnswer: gameState.answers[teamId] ? { choice: gameState.answers[teamId].choice } : null,
      lastReveal: snap.lastReveal,
      teams: gameState.teams
    }
  });

  io.emit('teams-updated', gameState.teams);
  if (gameState.phase === 'answering') io.emit('answer-progress', answerProgress());
  console.log(`[+] Participante conectado: "${cleanName}" (${teamId})`);
}

// Socket.IO Events
io.on('connection', (socket) => {
  // Join Host
  socket.on('join-host', () => {
    socket.join('host');
    socket.emit('init-host', {
      meta: boardMeta(),
      state: snapshot()
    });
  });

  // Mobile client joins game (supports both 'join-game' and 'register-team')
  socket.on('join-game', (data) => {
    handleRegisterTeam(socket, data?.name || data?.teamName, data?.key);
  });

  socket.on('register-team', (data) => {
    handleRegisterTeam(socket, data?.name || data?.teamName, data?.key);
  });

  // Host opens a question from the board
  socket.on('open-question', ({ catIndex, qIndex } = {}) => {
    const cat = questionsData.categorias[catIndex];
    if (!cat || !cat.preguntas[qIndex]) return;
    if (gameState.board[catIndex]?.[qIndex]) return;
    const q = cat.preguntas[qIndex];
    openQuestion(q, {
      catIndex,
      qIndex,
      isFinal: false,
      categoria: cat.nombre,
      puntos: q.puntos,
      maxPoints: Number(q.puntos) || 100
    });
  });

  // Final round (same 4-option mechanic)
  socket.on('start-final-jeopardy', () => {
    const fj = questionsData.final_jeopardy;
    if (!fj) return;
    openQuestion(fj, {
      catIndex: null,
      qIndex: null,
      isFinal: true,
      categoria: fj.categoria,
      puntos: 'FINAL',
      maxPoints: FINAL_POINTS
    });
  });

  // Host starts the 30-second answer window
  socket.on('start-answering', startAnswering);
  socket.on('activate-buzzer', startAnswering); // alias por compatibilidad

  // Host closes the answer window early
  socket.on('end-answering', revealAnswer);

  // Player submits an option
  socket.on('submit-answer', ({ choice } = {}) => {
    const teamId = socket.teamId;
    if (!teamId || !gameState.teams[teamId]) return;
    if (gameState.phase !== 'answering' || !gameState.current) return;
    if (gameState.answers[teamId]) return;
    const idx = Number(choice);
    if (!Number.isInteger(idx) || idx < 0 || idx >= gameState.current.opciones.length) return;

    const duration = gameState.durationMs || answerTime();
    const elapsedMs = Math.min(duration, Date.now() - gameState.startedAt);
    const correct = idx === gameState.current.correctIndex;
    const max = gameState.current.maxPoints;
    const points = correct
      ? Math.round(max * (1 - (1 - MIN_POINTS_RATIO) * (elapsedMs / duration)))
      : 0;

    gameState.answers[teamId] = { choice: idx, elapsedMs, correct, points };
    socket.emit('answer-accepted', { choice: idx, elapsedMs });
    io.emit('answer-progress', answerProgress());
    maybeRevealEarly();
  });

  // Close question modal
  socket.on('close-question', () => {
    clearAnswerTimer();
    gameState.current = null;
    gameState.phase = 'board';
    gameState.answers = {};
    gameState.startedAt = null;
    gameState.lastReveal = null;
    io.emit('question-closed', { board: gameState.board, finalDone: gameState.finalDone });
  });

  // Elegir público: cambia el banco de preguntas y reinicia tablero y puntos
  socket.on('set-audience', ({ audience: requested } = {}) => {
    if (!AUDIENCES[requested]) return;
    if (requested === audience) {
      socket.emit('audience-changed', { meta: boardMeta(), state: snapshot(), changed: false });
      return;
    }
    audience = requested;
    questionsData = banks[audience];
    initBoard();
    Object.keys(gameState.teams).forEach(id => {
      gameState.teams[id].score = 0;
      gameState.teams[id].lastGain = 0;
    });
    io.emit('audience-changed', { meta: boardMeta(), state: snapshot(), changed: true });
    io.emit('game-reset', { teams: gameState.teams, board: gameState.board });
    console.log(`[*] Público: ${AUDIENCES[audience].label}. Tablero y puntos reiniciados.`);
  });

  // Reset entire game
  socket.on('reset-game', () => {
    initBoard();
    Object.keys(gameState.teams).forEach(id => {
      gameState.teams[id].score = 0;
      gameState.teams[id].lastGain = 0;
    });
    io.emit('game-reset', {
      teams: gameState.teams,
      board: gameState.board
    });
    console.log('[*] Tablero y puntajes reiniciados.');
  });

  // End Game & Champion Podium
  socket.on('end-game', () => {
    const sorted = Object.values(gameState.teams).sort((a, b) => b.score - a.score);
    const ranking = sorted.map((t, idx) => ({
      ...t,
      rank: idx + 1
    }));
    io.emit('game-ended', { ranking });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.teamId && gameState.teams[socket.teamId]) {
      // Si el mismo equipo sigue conectado en otro celular, no marcarlo como desconectado
      const room = io.sockets.adapter.rooms.get('team-' + socket.teamId);
      if (!room || room.size === 0) {
        gameState.teams[socket.teamId].connected = false;
      }
      io.emit('teams-updated', gameState.teams);
      if (gameState.phase === 'answering') {
        io.emit('answer-progress', answerProgress());
        maybeRevealEarly();
      }
    }
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎬 JEOPARDY: EDUCACIÓN FINANCIERA - ESTUDIO A`);
  console.log(`   (Modo Kahoot: 4 opciones · Niñas y niños ${AUDIENCES.ninos.answerTimeMs / 1000} s · Personas adultas ${AUDIENCES.adultos.answerTimeMs / 1000} s)`);
  console.log(`======================================================`);
  console.log(`🖥️  Host / Proyector: http://localhost:${PORT}`);
  console.log(`📱 Celulares: http://localhost:${PORT}/buzzer.html`);
  console.log(`======================================================\n`);
});
