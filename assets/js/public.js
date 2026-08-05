import { isFirebaseConfigured, watchRoom } from "./firebase-service.js";
import {
  loadJson,
  sanitizeRoomCode,
  objectEntries,
  objectValues,
  escapeHtml,
  formatPhase,
  getQuestion
} from "./shared.js";

const stage = document.getElementById("publicStage");
const roomCodeElement = document.getElementById("roomCode");
const phaseLabel = document.getElementById("phaseLabel");
const showTitle = document.getElementById("showTitle");
const subtitle = document.getElementById("subtitle");
const weekLabel = document.getElementById("weekLabel");
const banner = document.getElementById("connectionBanner");

let settings;
let questionsData;
let roomCode;

async function init() {
  [settings, questionsData] = await Promise.all([
    loadJson("./content/settings.json"),
    loadJson("./content/questions.json")
  ]);

  roomCode = sanitizeRoomCode(new URLSearchParams(location.search).get("sala")) || settings.defaultRoomCode;
  roomCodeElement.textContent = roomCode;
  showTitle.textContent = settings.showTitle;
  subtitle.textContent = settings.subtitle || "";
  weekLabel.textContent = questionsData.weekLabel || settings.weekLabel || "SEMANA";
  document.title = settings.showTitle;

  if (!isFirebaseConfigured()) {
    showSetupMessage();
    return;
  }

  watchRoom(roomCode, renderRoom, error => {
    console.error(error);
    banner.hidden = false;
    banner.className = "connection-banner error";
    banner.textContent = "No se pudo conectar con la sala.";
  });
}

function showSetupMessage() {
  phaseLabel.textContent = "CONFIGURACIÓN";
  stage.innerHTML = `
    <div class="hero-state">
      <p class="eyebrow">PRIMER PASO</p>
      <h2>Conecta Firebase</h2>
      <p>Edita <strong>config/firebase-config.js</strong> para activar la sala compartida.</p>
    </div>`;
}

function renderRoom(room) {
  banner.hidden = true;
  if (!room) {
    phaseLabel.textContent = "SIN SALA";
    stage.innerHTML = `
      <div class="hero-state">
        <p class="eyebrow">SALA ${escapeHtml(roomCode)}</p>
        <h2>Esperando producción</h2>
        <p>El organizador todavía no ha creado esta sala.</p>
      </div>`;
    return;
  }

  const phase = room.meta?.phase || "lobby";
  phaseLabel.textContent = formatPhase(phase);

  if (phase === "lobby") renderLobby(room);
  else if (phase === "naming") renderNaming(room);
  else if (phase === "draft") renderDraft(room);
  else if (phase === "teamReady") renderTeamsReady(room);
  else if (phase === "game") renderGame(room);
  else renderLobby(room);
}

function renderLobby(room) {
  const players = objectValues(room.players).filter(Boolean);
  stage.innerHTML = `
    <div class="hero-state">
      <p class="eyebrow">REGISTRO ${room.meta?.registrationOpen ? "ABIERTO" : "CERRADO"}</p>
      <div class="big-count">${players.length}</div>
      <h2>${players.length === 1 ? "furro en sala" : "furros en sala"}</h2>
      <div class="name-cloud">
        ${players.map(player => `<span class="name-chip">${escapeHtml(player.name)}</span>`).join("")}
      </div>
    </div>`;
}

function renderNaming(room) {
  stage.innerHTML = `
    <div class="hero-state">
      <p class="eyebrow">CAPITANES ELEGIDOS</p>
      <h2>Que cada equipo encuentre su nombre</h2>
      ${renderTeamGrid(room)}
    </div>`;
}

function renderDraft(room) {
  const order = room.draft?.order || [];
  const currentIndex = room.draft?.currentPick || 0;
  const captainId = order[currentIndex];
  const captain = room.players?.[captainId];
  stage.innerHTML = `
    <div class="hero-state">
      <p class="eyebrow">DRAFT SERPIENTE</p>
      <h2>${captain ? `Turno de ${escapeHtml(captain.name)}` : "Selección terminada"}</h2>
      <p>${captain ? "El capitán está escogiendo a su siguiente integrante." : "Preparando los equipos."}</p>
      ${renderTeamGrid(room, captain?.teamId)}
    </div>`;
}

function renderTeamsReady(room) {
  stage.innerHTML = `
    <div class="hero-state">
      <p class="eyebrow">EQUIPOS COMPLETOS</p>
      <h2>La encuesta está por comenzar</h2>
      ${renderTeamGrid(room)}
    </div>`;
}

function renderTeamGrid(room, activeTeamId = null) {
  const teams = objectEntries(room.teams);
  return `
    <div class="public-team-grid">
      ${teams.map(([teamId, team]) => {
        const memberIds = Object.keys(team.members || {});
        const memberNames = memberIds.map(id => room.players?.[id]?.name).filter(Boolean);
        return `
          <article class="public-team-card ${teamId === activeTeamId ? "active" : ""}">
            <h3>${escapeHtml(team.name || "Nombre pendiente")}</h3>
            <div class="captain">Capitán: ${escapeHtml(room.players?.[team.captainId]?.name || "—")}</div>
            <p>${memberNames.map(escapeHtml).join(" · ") || "Esperando integrantes"}</p>
          </article>`;
      }).join("")}
    </div>`;
}

function renderGame(room) {
  const game = room.game || {};
  const question = getQuestion(questionsData, game.questionIndex || 0);
  if (!question) {
    stage.innerHTML = `<div class="hero-state"><h2>No hay más preguntas</h2></div>`;
    return;
  }

  const revealed = game.revealed || {};
  const bank = Object.keys(revealed).reduce((sum, index) => {
    if (!revealed[index]) return sum;
    return sum + Number(question.answers?.[Number(index)]?.points || 0) * Number(question.multiplier || 1);
  }, 0);
  const teams = objectEntries(room.teams);

  stage.innerHTML = `
    <div class="board-wrap">
      <div class="score-strip">
        ${teams.map(([teamId, team]) => `
          <div class="score-card ${game.activeTeamId === teamId ? "active" : ""}">
            ${escapeHtml(team.name || teamId)}
            <strong>${Number(team.score || 0)}</strong>
          </div>`).join("")}
      </div>
      <div class="round-bank">PUNTOS DE LA RONDA <strong>${bank}</strong></div>
      <h2 class="question-text">${escapeHtml(question.text)}</h2>
      <div class="answer-board">
        ${(question.answers || []).map((answer, index) => {
          const isRevealed = Boolean(revealed[index]);
          return `
            <div class="answer-slot ${isRevealed ? "" : "hidden-answer"}">
              <span class="answer-number">${index + 1}</span>
              <span>${isRevealed ? escapeHtml(answer.text) : "RESPUESTA"}</span>
              <span class="answer-points">${isRevealed ? Number(answer.points || 0) : ""}</span>
            </div>`;
        }).join("")}
      </div>
      <div class="strikes">
        ${Array.from({ length: Number(game.strikes || 0) }, () => `<span class="strike">✕</span>`).join("")}
      </div>
    </div>`;
}

init().catch(error => {
  console.error(error);
  stage.innerHTML = `<div class="hero-state"><h2>Error al cargar</h2><p>${escapeHtml(error.message)}</p></div>`;
});
