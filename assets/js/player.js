import {
  isFirebaseConfigured,
  joinRoom,
  watchRoom,
  submitPlayerRequest,
  currentUser
} from "./firebase-service.js";
import {
  loadJson,
  sanitizeRoomCode,
  normalizeName,
  escapeHtml,
  objectEntries,
  objectValues,
  formatPhase
} from "./shared.js";

const joinPanel = document.getElementById("joinPanel");
const playerPanel = document.getElementById("playerPanel");
const roomInput = document.getElementById("roomInput");
const nameInput = document.getElementById("nameInput");
const joinButton = document.getElementById("joinButton");
const joinMessage = document.getElementById("joinMessage");
const playerStatus = document.getElementById("playerStatus");

let settings;
let roomCode = "";
let playerName = "";
let playerUid = "";
let unsubscribeRoom = null;
let latestRoom = null;

async function init() {
  settings = await loadJson("./content/settings.json");
  const params = new URLSearchParams(location.search);
  roomInput.value = sanitizeRoomCode(params.get("sala")) || localStorage.getItem("furros_room") || settings.defaultRoomCode;
  nameInput.value = localStorage.getItem("furros_name") || "";

  if (!isFirebaseConfigured()) {
    joinButton.disabled = true;
    setMessage("Primero configura Firebase en config/firebase-config.js.", true);
    return;
  }

  joinButton.addEventListener("click", handleJoin);
  nameInput.addEventListener("keydown", event => {
    if (event.key === "Enter") handleJoin();
  });
}

async function handleJoin() {
  roomCode = sanitizeRoomCode(roomInput.value);
  playerName = normalizeName(nameInput.value);

  if (!roomCode || !playerName) {
    setMessage("Escribe un código de sala y tu nombre.", true);
    return;
  }

  joinButton.disabled = true;
  setMessage("Entrando…");

  try {
    const user = await joinRoom(roomCode, playerName);
    playerUid = user.uid;
    localStorage.setItem("furros_room", roomCode);
    localStorage.setItem("furros_name", playerName);
    history.replaceState(null, "", `?sala=${encodeURIComponent(roomCode)}`);
    joinPanel.hidden = true;
    playerPanel.hidden = false;
    playerStatus.textContent = `SALA ${roomCode}`;
    playerStatus.classList.add("online");

    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = watchRoom(roomCode, room => {
      latestRoom = room;
      renderPlayer(room);
    }, error => {
      console.error(error);
      playerPanel.innerHTML = `<p class="form-message error">No se pudo leer la sala.</p>`;
    });
  } catch (error) {
    console.error(error);
    setMessage(error.message || "No se pudo entrar.", true);
    joinButton.disabled = false;
  }
}

function renderPlayer(room) {
  if (!room) {
    playerPanel.innerHTML = `
      <p class="eyebrow">SALA ${escapeHtml(roomCode)}</p>
      <h1>La sala todavía no existe</h1>
      <p class="subtitle">Pídele al organizador que la cree desde la cabina de control.</p>`;
    return;
  }

  const me = room.players?.[playerUid];
  if (!me) {
    playerPanel.innerHTML = `<p class="form-message error">Tu registro ya no aparece en la sala. Recarga para volver a entrar.</p>`;
    return;
  }

  const phase = room.meta?.phase || "lobby";
  const team = me.teamId ? room.teams?.[me.teamId] : null;
  const allPlayers = objectEntries(room.players);

  let content = `
    <div class="section-heading">
      <div>
        <p class="eyebrow">${escapeHtml(formatPhase(phase))}</p>
        <h1>${escapeHtml(me.name)}</h1>
      </div>
      <span class="status-pill online">${me.captain ? "CAPITÁN" : team ? "EN EQUIPO" : "EN SALA"}</span>
    </div>`;

  if (phase === "lobby") {
    content += renderLobby(room, allPlayers);
  } else if (phase === "naming") {
    content += renderNaming(room, me, team);
  } else if (phase === "draft") {
    content += renderDraft(room, me, team);
  } else if (phase === "teamReady") {
    content += renderTeamReady(room, me, team);
  } else if (phase === "game") {
    content += renderGameState(room, me, team);
  } else {
    content += `<p class="subtitle">Esperando instrucciones del organizador.</p>`;
  }

  playerPanel.innerHTML = content;
  bindDynamicActions(room, me, team);
}

function renderLobby(room, allPlayers) {
  return `
    <div class="notice">${room.meta?.registrationOpen ? "El registro sigue abierto." : "El registro ya está cerrado."} Hay ${allPlayers.length} personas.</div>
    <div class="name-cloud">
      ${allPlayers.map(([, player]) => `<span class="name-chip">${escapeHtml(player.name)}</span>`).join("")}
    </div>`;
}

function renderNaming(room, me, team) {
  if (!me.captain) {
    return `
      <div class="notice">Los capitanes están eligiendo los nombres de sus equipos.</div>
      ${renderMyTeam(room, team)}`;
  }

  return `
    <div class="player-card">
      <p class="eyebrow">TU EQUIPO</p>
      <h2>${escapeHtml(team?.name || "Elige un nombre")}</h2>
      <label class="field-label" for="teamNameInput">Nombre del equipo</label>
      <input id="teamNameInput" class="text-input" maxlength="28" value="${escapeHtml(team?.name || "")}" placeholder="Patitas Mojadas">
      <button id="saveTeamNameButton" class="primary-button" type="button">GUARDAR NOMBRE</button>
    </div>
    ${renderMyTeam(room, team)}`;
}

function renderDraft(room, me, team) {
  const order = room.draft?.order || [];
  const currentIndex = Number(room.draft?.currentPick || 0);
  const currentCaptainId = order[currentIndex];
  const currentCaptain = room.players?.[currentCaptainId];
  const available = objectEntries(room.players).filter(([, player]) => !player.teamId && !player.captain);

  if (currentCaptainId === playerUid) {
    return `
      <div class="notice current-turn">ES TU TURNO. Escoge a una persona.</div>
      <div class="choice-grid">
        ${available.map(([id, player]) => `<button class="choice-button pick-player-button" data-player-id="${escapeHtml(id)}" type="button">${escapeHtml(player.name)}</button>`).join("") || "No quedan personas por elegir."}
      </div>
      ${renderMyTeam(room, team)}`;
  }

  return `
    <div class="notice">${currentCaptain ? `Turno de ${escapeHtml(currentCaptain.name)}.` : "La selección está terminando."}</div>
    ${renderMyTeam(room, team)}`;
}

function renderTeamReady(room, me, team) {
  return `
    <div class="notice">Los equipos están completos. El concurso comenzará en cuanto producción lo indique.</div>
    ${renderMyTeam(room, team)}`;
}

function renderGameState(room, me, team) {
  const activeTeam = room.game?.activeTeamId ? room.teams?.[room.game.activeTeamId] : null;
  return `
    <div class="notice">Equipo en turno: <strong>${escapeHtml(activeTeam?.name || "Por definir")}</strong></div>
    ${renderMyTeam(room, team)}
    <p class="subtitle">El tablero principal se actualiza en vivo para todas las personas.</p>`;
}

function renderMyTeam(room, team) {
  if (!team) return `<div class="notice">Todavía no tienes equipo.</div>`;
  const members = Object.keys(team.members || {}).map(id => room.players?.[id]?.name).filter(Boolean);
  return `
    <article class="team-card">
      <p class="eyebrow">${escapeHtml(team.name || "EQUIPO")}</p>
      <h3>Capitán: ${escapeHtml(room.players?.[team.captainId]?.name || "—")}</h3>
      <ul>${members.map(name => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
    </article>`;
}

function bindDynamicActions(room, me, team) {
  const saveNameButton = document.getElementById("saveTeamNameButton");
  if (saveNameButton) {
    saveNameButton.addEventListener("click", async () => {
      const input = document.getElementById("teamNameInput");
      const value = normalizeName(input.value).slice(0, 28);
      if (!value || !team) return;
      saveNameButton.disabled = true;
      await submitPlayerRequest(roomCode, {
        type: "setTeamName",
        teamId: me.teamId,
        value
      });
      saveNameButton.textContent = "ENVIADO";
    });
  }

  document.querySelectorAll(".pick-player-button").forEach(button => {
    button.addEventListener("click", async () => {
      const playerId = button.dataset.playerId;
      document.querySelectorAll(".pick-player-button").forEach(item => item.disabled = true);
      await submitPlayerRequest(roomCode, {
        type: "pickPlayer",
        playerId
      });
    });
  });
}

function setMessage(message, isError = false) {
  joinMessage.textContent = message;
  joinMessage.classList.toggle("error", isError);
}

init().catch(error => {
  console.error(error);
  setMessage(error.message || "No se pudo iniciar.", true);
});
