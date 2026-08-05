export async function loadJson(path) {
  const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo cargar ${path}`);
  return response.json();
}

export function sanitizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 12);
}

export function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 32);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function objectValues(value) {
  return value && typeof value === "object" ? Object.values(value) : [];
}

export function objectEntries(value) {
  return value && typeof value === "object" ? Object.entries(value) : [];
}

export function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function recommendedTeamCount(playerCount, maxTeams = 6) {
  if (playerCount < 4) return 0;
  if (playerCount <= 8) return 2;
  if (playerCount <= 15) return Math.min(3, maxTeams);
  if (playerCount <= 24) return Math.min(4, maxTeams);
  if (playerCount <= 35) return Math.min(5, maxTeams);
  return Math.min(6, maxTeams);
}

export function buildSnakeDraftOrder(captainIds, picksNeeded) {
  const order = [];
  let round = 0;
  while (order.length < picksNeeded) {
    const direction = round % 2 === 0 ? captainIds : [...captainIds].reverse();
    for (const captainId of direction) {
      if (order.length >= picksNeeded) break;
      order.push(captainId);
    }
    round += 1;
  }
  return order;
}

export function getTeamForPlayer(room, playerId) {
  const players = room?.players || {};
  const teamId = players[playerId]?.teamId;
  return teamId ? room?.teams?.[teamId] : null;
}

export function formatPhase(phase) {
  const labels = {
    lobby: "REGISTRO",
    naming: "NOMBRES DE EQUIPO",
    draft: "SELECCIÓN DE EQUIPOS",
    teamReady: "EQUIPOS LISTOS",
    game: "EN JUEGO",
    finished: "FINAL"
  };
  return labels[phase] || "ESPERANDO";
}

export function getQuestion(questionsData, index) {
  const questions = (questionsData?.questions || []).filter(q => q.enabled !== false);
  return questions[index] || null;
}
