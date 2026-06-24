// functions/api/scores.js
// Cloudflare Pages Function — free scores proxy
// No API key needed. Uses worldcup26.ir + openfootball fallback

const PRIMARY_URL = "https://worldcup26.ir/get/games";
const FALLBACK_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

export async function onRequestGet() {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  // Try worldcup26.ir first
  try {
    const res = await fetch(PRIMARY_URL, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`worldcup26.ir ${res.status}`);
    const data = await res.json();
    const matches = parseWorldcup26(data);
    return new Response(JSON.stringify({ source: "worldcup26.ir", matches }), { status: 200, headers });
  } catch (e1) {
    console.log("Primary failed:", e1.message);
  }

  // Fallback: openfootball
  try {
    const res = await fetch(FALLBACK_URL, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`openfootball ${res.status}`);
    const data = await res.json();
    const matches = parseOpenFootball(data);
    return new Response(JSON.stringify({ source: "openfootball", matches }), { status: 200, headers });
  } catch (e2) {
    return new Response(JSON.stringify({ error: "All sources failed", detail: e2.message }), {
      status: 503,
      headers,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

/* ── worldcup26.ir parser ── */
function parseWorldcup26(data) {
  const games = data.games || data || [];
  return games.map(g => ({
    id: g.id,
    group: g.group,
    home: g.home_team_name_en,
    away: g.away_team_name_en,
    homeScore: g.home_score !== undefined && g.home_score !== "null" ? parseInt(g.home_score) : null,
    awayScore: g.away_score !== undefined && g.away_score !== "null" ? parseInt(g.away_score) : null,
    status: mapStatus(g.finished, g.time_elapsed),
    minute: parseMinute(g.time_elapsed),
    kickoff: parseLocalDate(g.local_date),
    homeScorers: parseScorers(g.home_scorers),
    awayScorers: parseScorers(g.away_scorers),
  }));
}

function mapStatus(finished, elapsed) {
  if (finished === "TRUE" || finished === true) return "FINISHED";
  if (!elapsed || elapsed === "notstarted") return "SCHEDULED";
  if (elapsed === "halftime") return "LIVE";
  if (elapsed === "fulltime") return "FINISHED";
  if (elapsed === "extratime") return "EXTRA_TIME";
  if (elapsed === "penaltyshootout") return "PENALTY";
  if (elapsed === "delayed" || elapsed === "suspended") return "DELAYED";
  return "LIVE";
}

function parseMinute(elapsed) {
  if (!elapsed || elapsed === "notstarted") return 0;
  const n = parseInt(elapsed);
  return isNaN(n) ? 0 : n;
}

function parseScorers(raw) {
  if (!raw || raw === "null") return [];
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { return []; }
}

function parseLocalDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  try {
    const [datePart, timePart] = dateStr.split(" ");
    const [m, d, y] = datePart.split("/");
    return new Date(`${y}-${m}-${d}T${timePart}:00-05:00`).toISOString();
  } catch { return new Date().toISOString(); }
}

/* ── openfootball parser ── */
function parseOpenFootball(data) {
  const out = [];
  (data.matches || []).forEach(m => {
    const kickoff = parseOFKickoff(m.date, m.time);
    const hs = m.score?.ft?.[0] ?? null;
    const as_ = m.score?.ft?.[1] ?? null;
    out.push({
      id: m.num || Math.random(),
      group: (m.round || "").replace("Group ", "").replace("Matchday ", "").trim() || "–",
      home: m.team1 || "TBD",
      away: m.team2 || "TBD",
      homeScore: hs,
      awayScore: as_,
      status: inferStatus(kickoff, hs),
      minute: null,
      kickoff,
      homeScorers: (m.goals1 || []).map(g => ({ name: g.name, minute: g.minute })),
      awayScorers: (m.goals2 || []).map(g => ({ name: g.name, minute: g.minute })),
    });
  });
  return out;
}

function parseOFKickoff(date, time) {
  if (!date) return new Date().toISOString();
  const m = (time || "").match(/(\d+):(\d+)\s*UTC([+-]\d+)/);
  if (!m) return new Date(date + "T00:00:00Z").toISOString();
  const offsetH = parseInt(m[3]);
  const utcH = parseInt(m[1]) - offsetH;
  const utcMin = parseInt(m[2]);
  const pad = n => String(Math.floor(n)).padStart(2, "0");
  return new Date(`${date}T${pad(utcH)}:${pad(utcMin)}:00Z`).toISOString();
}

function inferStatus(kickoff, hs) {
  const diff = Date.now() - new Date(kickoff).getTime();
  if (diff < 0) return "SCHEDULED";
  if (hs !== null && diff > 105 * 60 * 1000) return "FINISHED";
  if (diff < 105 * 60 * 1000) return "LIVE";
  return "FINISHED";
}
