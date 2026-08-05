import {
  isFirebaseConfigured,
  hostLogin,
  logout,
  checkAdmin,
  watchRoom,
  hostSetRoom,
  hostUpdateRoom,
  hostSetPath
} from "./firebase-service.js";
import {
  loadJson,
  sanitizeRoomCode,
  normalizeName,
  escapeHtml,
  objectEntries,
  recommendedTeamCount,
  buildSnakeDraftOrder,
  shuffle,
  getQuestion,
  formatPhase
} from "./shared.js";

const loginPanel = document.getElementById("loginPanel");
const controlPanel = document.getElementById("controlPanel");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const loginButton = document.getElementById("loginButton");
const loginMessage = document.getElementById("loginMessage");
const adminStatus = document.getElementById("adminStatus");
const controlRoomInput = document.getElementById("controlRoomInput");
const playerCount = document.getElementById("playerCount");
const adminPlayers = document.getElementById("adminPlayers");
const adminTeams = document.getElementById("adminTeams");
const draftStatus = document.getElementById("draftStatus");
const adminQuestionTitle = document.getElementById("adminQuestionTitle");
const adminAnswers = document.getElementById("adminAnswers");
const activeTeamSelect = document.getElementById("activeTeamSelect");

let settings;
let questionsData;
let roomCode = "";
let latestRoom = null;
let unsubscribeRoom = null;
let processingRequest = false;

async function init() {
  [settings, questionsData] = await Promise.all([
    loadJson("./content/settings.json"),
    loadJson("./content/questions.json")
  ]);
  controlRoomInput.value = settings.defaultRoomCode || "FURROS";
  bindStaticControls();

  if (!isFirebaseConfigured()) {
    loginButton.disabled = true;
    setLoginMessage("Configura Firebase en config/firebase-config.js antes de abrir la cabina.", true);
  }
}

function bindStaticControls() {
  loginButton.addEventListener("click", handleLogin);
  passwordInput.addEventListener("keydown", event => {
    if (event.key === "Enter") handleLogin();
  });

  document.getElementById("logoutButton").addEventListener("click", async () => {
    if (unsubscribeRoom) unsubscribeRoom();
    await logout();
    location.reload();
  });

  document.getElementById("loadRoomButton").addEventListener("click", loadSelectedRoom);
  document.getElementById("createRoomButton").addEventListener("click", createRoom);
  document.getElementById("toggleRegistrationButton").addEventListener("click", toggleRegistration);
  document.getElementById("makeTeamsButton").addEventListener("click", makeTeams);
  document.getElementById("startDraftButton").addEventListener("click", startDraft);
  document.getElementById("startGameButton").addEventListener("click", startGame);
  document.getElementById("strikeButton").addEventListener("click", addStrike);
  document.getElementById("clearStrikesButton").addEventListener("click", clearStrikes);
  document.getElementById("awardPointsButton").addEventListener("click", awardRoundPoints);
  document.getElementById("previousQuestionButton").addEventListener("click", () => changeQuestion(-1));
  document.getElementById("nextQuestionButton").addEventListener("click", () => changeQuestion(1));
  activeTeamSelect.addEventListener("change", async () => {
    if (!latestRoom) return;
    await hostSetPath(roomCode, "game/activeTeamId", activeTeamSelect.value || null);
  });
}

async function handleLogin() {
  loginButton.disabled = true;
  setLoginMessage("Verificando acceso…");
  try {
    const credential = await hostLogin(emailInput.value.trim(), passwordInput.value);
    const allowed = await checkAdmin(credential.user.uid);
    if (!allowed) {
      setLoginMessage(`Este usuario no está autorizado. Añade admins/${credential.user.uid} = true en Realtime Database.`, true);
      loginButton.disabled = false;
      return;
    }

    adminStatus.textContent = "PRODUCCIÓN EN LÍNEA";
    adminStatus.classList.add("online");
    loginPanel.hidden = true;
    controlPanel.hidden = false;
    loadSelectedRoom();
  } catch (error) {
    console.error(error);
    setLoginMessage(error.message || "No se pudo iniciar sesión.", true);
    loginButton.disabled = false;
  }
}

function loadSelectedRoom() {
  roomCode = sanitizeRoomCode(controlRoomInput.value) || settings.defaultRoomCode;
  controlRoomInput.value = roomCode;
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = watchRoom(roomCode, room => {
    latestRoom = room;
    renderControl();
    processOnePlayerRequest(room);
  }, error => {
    console.error(error);
    draftStatus.textContent = "No se pudo leer la sala.";
  });
}

async function createRoom() {
  const code = sanitizeRoomCode(controlRoomInput.value) || settings.defaultRoomCode;
  const confirmed = window.confirm(`Esto reiniciará por completo la sala ${code}, incluyendo participantes y puntuación. ¿Continuar?`);
  if (!confirmed) return;
  roomCode = code;
  await hostSetRoom(roomCode, {
    meta: {
      phase: "lobby",
      registrationOpen: settings.registrationOpenByDefault !== false,
      createdAt: Date.now(),
      weekLabel: questionsData.weekLabel || settings.weekLabel || ""
    },
    players: {},
    requests: {},
    teams: {},
    draft: {},
    game: {
      questionIndex: 0,
      revealed: {},
      strikes: 0,
      activeTeamId: ""
    }
  });
}

async function toggleRegistration() {
  if (!latestRoom) return;
  const open = latestRoom.meta?.registrationOpen !== false;
  await hostSetPath(roomCode, "meta/registrationOpen", !open);
}

async function makeTeams() {
  if (!latestRoom) return;
  const players = objectEntries(latestRoom.players).filter(([, player]) => player?.name);
  const teamCount = recommendedTeamCount(players.length, Number(settings.maxTeams || 6));
  if (!teamCount) {
    alert(`Necesitas al menos ${settings.minPlayers || 4} personas.`);
    return;
  }

  const shuffledPlayers = shuffle(players);
  const captains = shuffledPlayers.slice(0, teamCount);
  const teams = {};
  const patch = {
    teams: {},
    draft: {},
    requests: {},
    "meta/phase": "naming"
  };

  players.forEach(([id]) => {
    patch[`players/${id}/captain`] = false;
    patch[`players/${id}/teamId`] = null;
  });

  captains.forEach(([captainId], index) => {
    const teamId = `team${index + 1}`;
    teams[teamId] = {
      name: "",
      captainId,
      members: { [captainId]: true },
      score: 0
    };
    patch[`players/${captainId}/captain`] = true;
    patch[`players/${captainId}/teamId`] = teamId;
  });

  patch.teams = teams;
  await hostUpdateRoom(roomCode, patch);
}

async function startDraft() {
  if (!latestRoom) return;
  const teams = objectEntries(latestRoom.teams);
  if (teams.length < 2) {
    alert("Primero sortea los equipos y capitanes.");
    return;
  }

  const captainIds = teams.map(([, team]) => team.captainId).filter(Boolean);
  const availableIds = objectEntries(latestRoom.players)
    .filter(([, player]) => !player.teamId && !player.captain)
    .map(([id]) => id);
  const order = buildSnakeDraftOrder(captainIds, availableIds.length);

  await hostUpdateRoom(roomCode, {
    draft: {
      order,
      currentPick: 0,
      totalPicks: order.length,
      startedAt: Date.now()
    },
    "meta/phase": order.length ? "draft" : "teamReady"
  });
}

async function startGame() {
  if (!latestRoom) return;
  const teams = objectEntries(latestRoom.teams);
  if (teams.length < 2) {
    alert("Aún no hay equipos suficientes.");
    return;
  }
  const firstTeamId = teams[0][0];
  await hostUpdateRoom(roomCode, {
    "meta/phase": "game",
    game: {
      questionIndex: 0,
      revealed: {},
      strikes: 0,
      activeTeamId: firstTeamId,
      startedAt: Date.now()
    }
  });
}

async function processOnePlayerRequest(room) {
  if (processingRequest || !room?.requests) return;
  const requestEntry = objectEntries(room.requests).find(([, request]) => request?.type);
  if (!requestEntry) return;

  processingRequest = true;
  const [requesterId, request] = requestEntry;
  const requester = room.players?.[requesterId];
  const clearRequest = { [`requests/${requesterId}`]: null };

  try {
    if (!requester) {
      await hostUpdateRoom(roomCode, clearRequest);
      return;
    }

    if (request.type === "setTeamName") {
      const team = room.teams?.[request.teamId];
      const name = normalizeName(request.value).slice(0, 28);
      if (team && team.captainId === requesterId && name) {
        await hostUpdateRoom(roomCode, {
          [`teams/${request.teamId}/name`]: name,
          ...clearRequest
        });
      } else {
        await hostUpdateRoom(roomCode, clearRequest);
      }
      return;
    }

    if (request.type === "pickPlayer") {
      const order = room.draft?.order || [];
      const pickIndex = Number(room.draft?.currentPick || 0);
      const expectedCaptainId = order[pickIndex];
      const selected = room.players?.[request.playerId];
      const teamId = requester.teamId;
      const valid = room.meta?.phase === "draft" &&
        expectedCaptainId === requesterId &&
        selected && !selected.teamId && !selected.captain &&
        teamId && room.teams?.[teamId]?.captainId === requesterId;

      if (!valid) {
        await hostUpdateRoom(roomCode, clearRequest);
        return;
      }

      const nextPick = pickIndex + 1;
      const finished = nextPick >= order.length;
      await hostUpdateRoom(roomCode, {
        [`players/${request.playerId}/teamId`]: teamId,
        [`teams/${teamId}/members/${request.playerId}`]: true,
        "draft/currentPick": nextPick,
        "meta/phase": finished ? "teamReady" : "draft",
        ...clearRequest
      });
      return;
    }

    await hostUpdateRoom(roomCode, clearRequest);
  } catch (error) {
    console.error("Error procesando solicitud", error);
  } finally {
    processingRequest = false;
    setTimeout(() => processOnePlayerRequest(latestRoom), 0);
  }
}

function renderControl() {
  renderPlayers();
  renderTeams();
  renderQuestionControls();

  const open = latestRoom?.meta?.registrationOpen !== false;
  document.getElementById("toggleRegistrationButton").textContent = open ? "CERRAR REGISTRO" : "ABRIR REGISTRO";
  adminStatus.textContent = latestRoom ? `${roomCode} · ${formatPhase(latestRoom.meta?.phase)}` : `${roomCode} · SIN CREAR`;
}

function renderPlayers() {
  const players = objectEntries(latestRoom?.players);
  playerCount.textContent = `${players.length} ${players.length === 1 ? "persona" : "personas"}`;
  adminPlayers.innerHTML = players.length
    ? players.map(([id, player]) => `
        <div class="person-row">
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <div class="person-meta">${player.captain ? "Capitán" : player.teamId ? "Integrante" : "Disponible"}</div>
          </div>
          <span class="status-pill ${player.online ? "online" : ""}">${player.online ? "EN LÍNEA" : "AUSENTE"}</span>
        </div>`).join("")
    : `<div class="notice">Aún no se ha registrado nadie.</div>`;
}

function renderTeams() {
  const teams = objectEntries(latestRoom?.teams);
  adminTeams.innerHTML = teams.length
    ? teams.map(([teamId, team]) => {
        const members = Object.keys(team.members || {}).map(id => latestRoom.players?.[id]?.name).filter(Boolean);
        return `
          <article class="team-card">
            <h3>${escapeHtml(team.name || `Equipo ${teamId.replace("team", "")}`)}</h3>
            <div class="person-meta">Capitán: ${escapeHtml(latestRoom.players?.[team.captainId]?.name || "—")}</div>
            <ul>${members.map(name => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
            <p><strong>${Number(team.score || 0)} pts</strong></p>
          </article>`;
      }).join("")
    : `<div class="notice">Los equipos todavía no se han sorteado.</div>`;

  const order = latestRoom?.draft?.order || [];
  const currentPick = Number(latestRoom?.draft?.currentPick || 0);
  const captainId = order[currentPick];
  const captain = latestRoom?.players?.[captainId];
  draftStatus.textContent = latestRoom?.meta?.phase === "draft"
    ? `Elección ${Math.min(currentPick + 1, order.length)} de ${order.length}. Turno de ${captain?.name || "—"}.`
    : `Fase actual: ${formatPhase(latestRoom?.meta?.phase)}.`;
}

function renderQuestionControls() {
  const game = latestRoom?.game || {};
  const questionIndex = Number(game.questionIndex || 0);
  const question = getQuestion(questionsData, questionIndex);
  const teams = objectEntries(latestRoom?.teams);

  activeTeamSelect.innerHTML = `<option value="">Equipo en turno</option>` + teams.map(([teamId, team]) => `
    <option value="${escapeHtml(teamId)}" ${game.activeTeamId === teamId ? "selected" : ""}>${escapeHtml(team.name || teamId)}</option>`).join("");

  if (!question) {
    adminQuestionTitle.textContent = "No hay preguntas";
    adminAnswers.innerHTML = `<div class="notice">Sube o edita content/questions.json.</div>`;
    return;
  }

  adminQuestionTitle.textContent = `${questionIndex + 1}. ${question.text}`;
  const revealed = game.revealed || {};
  adminAnswers.innerHTML = (question.answers || []).map((answer, index) => `
    <div class="admin-answer-row">
      <span>${index + 1}. ${escapeHtml(answer.text)} · ${Number(answer.points || 0)} pts</span>
      <button class="${revealed[index] ? "primary-button" : "secondary-button"} reveal-answer-button" data-answer-index="${index}" type="button">
        ${revealed[index] ? "REVELADA" : "REVELAR"}
      </button>
    </div>`).join("");

  document.querySelectorAll(".reveal-answer-button").forEach(button => {
    button.addEventListener("click", async () => {
      const index = button.dataset.answerIndex;
      const nextValue = !Boolean(latestRoom?.game?.revealed?.[index]);
      await hostSetPath(roomCode, `game/revealed/${index}`, nextValue);
    });
  });
}

async function addStrike() {
  if (!latestRoom) return;
  const next = Math.min(3, Number(latestRoom.game?.strikes || 0) + 1);
  await hostSetPath(roomCode, "game/strikes", next);
}

async function clearStrikes() {
  if (!latestRoom) return;
  await hostSetPath(roomCode, "game/strikes", 0);
}

async function awardRoundPoints() {
  if (!latestRoom) return;
  const teamId = activeTeamSelect.value || latestRoom.game?.activeTeamId;
  if (!teamId || !latestRoom.teams?.[teamId]) {
    alert("Elige el equipo que recibe los puntos.");
    return;
  }

  const question = getQuestion(questionsData, Number(latestRoom.game?.questionIndex || 0));
  if (!question) return;
  const revealed = latestRoom.game?.revealed || {};
  const bank = Object.keys(revealed).reduce((sum, index) => {
    if (!revealed[index]) return sum;
    return sum + Number(question.answers?.[Number(index)]?.points || 0) * Number(question.multiplier || 1);
  }, 0);
  const currentScore = Number(latestRoom.teams[teamId].score || 0);
  await hostUpdateRoom(roomCode, {
    [`teams/${teamId}/score`]: currentScore + bank,
    "game/strikes": 0
  });
}

async function changeQuestion(direction) {
  if (!latestRoom) return;
  const enabledQuestions = (questionsData.questions || []).filter(question => question.enabled !== false);
  const current = Number(latestRoom.game?.questionIndex || 0);
  const next = Math.max(0, Math.min(enabledQuestions.length - 1, current + direction));
  await hostUpdateRoom(roomCode, {
    "game/questionIndex": next,
    "game/revealed": {},
    "game/strikes": 0
  });
}

function setLoginMessage(message, isError = false) {
  loginMessage.textContent = message;
  loginMessage.classList.toggle("error", isError);
}

init().catch(error => {
  console.error(error);
  setLoginMessage(error.message || "No se pudo iniciar la cabina.", true);
});
