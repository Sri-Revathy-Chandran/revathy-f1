// api/f1.js  —  Vercel Serverless Function
// Fetches F1 data from Jolpica server-side (no CORS issues) and returns it to the browser.

const JOLPICA = 'https://api.jolpi.ca/ergast/f1';

const TEAM_MAP = {
  mercedes:'mercedes', ferrari:'ferrari', mclaren:'mclaren',
  red_bull:'red_bull', williams:'williams', haas:'haas',
  alpine:'alpine', sauber:'audi', audi:'audi',
  rb:'racing_bulls', racing_bulls:'racing_bulls', alphatauri:'racing_bulls',
  aston_martin:'aston_martin', cadillac:'cadillac',
};
const CIRCUIT_MAP = {
  albert_park:'albert_park', shanghai:'shanghai', suzuka:'suzuka',
  miami:'miami', villeneuve:'villeneuve', monaco:'monaco',
  catalunya:'catalunya', red_bull_ring:'red_bull_ring', silverstone:'silverstone',
  spa:'spa', hungaroring:'hungaroring', zandvoort:'zandvoort',
  monza:'monza', baku:'baku', marina_bay:'marina_bay',
  americas:'americas', rodriguez:'rodriguez', interlagos:'interlagos',
  vegas:'vegas', losail:'losail', yas_marina:'yas_marina',
  madrid:'madring',
};

function jTeam(id) { return TEAM_MAP[id] || id; }
function jCircuit(id) { return CIRCUIT_MAP[id] || id; }

async function jFetch(path) {
  const r = await fetch(`${JOLPICA}${path}.json?limit=100`);
  if (!r.ok) throw new Error(`Jolpica ${r.status} ${path}`);
  return r.json();
}

// --- Driver spotlight handler ---
async function handleDriver(driverId, res) {
  const raw = await jFetch(`/current/drivers/${driverId}/results`);
  const races = raw.MRData.RaceTable.Races || [];
  const season_results = races.map(r => {
    const result = r.Results && r.Results[0];
    return {
      pos: result ? result.position : '—',
      short_name: r.raceName.replace(' Grand Prix','').replace('Grand Prix','').trim().slice(0,3).toUpperCase(),
      points: result ? result.points : '0',
      status: result ? result.status : '',
    };
  });
  return res.status(200).json({ season_results });
}

// --- Main standings handler ---
async function handleStandings(res) {
  const [schedRaw, drvRaw, conRaw, lastRaw] = await Promise.all([
    jFetch('/current'),
    jFetch('/current/driverStandings'),
    jFetch('/current/constructorStandings'),
    jFetch('/current/last/results'),
  ]);

  // Schedule
  const races = schedRaw.MRData.RaceTable.Races || [];
  const now = Date.now();
  const schedule = races.map(r => {
    const raceUtc = r.date + 'T' + (r.time || '12:00:00Z');
    const raceMs = Date.parse(raceUtc);
    const status = raceMs < now - 3600000 ? 'done' : raceMs < now + 3600000 ? 'live' : 'upcoming';
    return {
      round: Number(r.round),
      short_name: r.raceName.replace('Grand Prix', 'GP').trim(),
      country: r.Circuit.Location.country,
      locality: r.Circuit.Location.locality,
      circuit: r.Circuit.circuitName,
      circuit_id: jCircuit(r.Circuit.circuitId),
      date: r.date,
      start_utc: raceUtc,
      status,
    };
  });

  const next_race = schedule.find(s => s.status === 'upcoming' || s.status === 'live') || null;

  // Driver standings
  const dsList = (drvRaw.MRData.StandingsTable.StandingsLists[0] || {}).DriverStandings || [];
  const maxPts = dsList.length ? Number(dsList[0].points) : 1;
  const drivers = dsList.map((d, i) => ({
    pos: Number(d.position),
    code: d.Driver.code || d.Driver.driverId.slice(0, 3).toUpperCase(),
    given_name: d.Driver.givenName,
    family_name: d.Driver.familyName,
    short_name: `${d.Driver.givenName.charAt(0)}. ${d.Driver.familyName}`,
    nationality: d.Driver.nationality,
    team_id: jTeam(d.Constructors[0]?.constructorId || ''),
    team_name: d.Constructors[0]?.name || '',
    pts: Number(d.points),
    wins: Number(d.wins),
    gap: i === 0 ? 0 : Number(d.points) - Number(dsList[0].points),
    permanent_number: d.Driver.permanentNumber || '',
    pct: Math.round((Number(d.points) / maxPts) * 100),
  }));

  // Constructor standings
  const csList = (conRaw.MRData.StandingsTable.StandingsLists[0] || {}).ConstructorStandings || [];
  const maxCPts = csList.length ? Number(csList[0].points) : 1;
  const constructors = csList.map(c => ({
    pos: Number(c.position),
    id: jTeam(c.Constructor.constructorId),
    name: c.Constructor.name,
    nationality: c.Constructor.nationality,
    pts: Number(c.points),
    wins: Number(c.wins),
    pct: Math.round((Number(c.points) / maxCPts) * 100),
  }));

  // Last race
  let last_race = null;
  const lastRaceList = lastRaw.MRData.RaceTable.Races || [];
  if (lastRaceList.length) {
    const lr = lastRaceList[0];
    const results = lr.Results || [];
    const podium = results.slice(0, 3).map(res => ({
      driver: `${res.Driver.givenName} ${res.Driver.familyName}`,
      driver_short: `${res.Driver.givenName.charAt(0)}. ${res.Driver.familyName}`,
      team: res.Constructor.name,
      team_id: jTeam(res.Constructor.constructorId),
      number: res.Driver.permanentNumber,
      time: res.Time ? res.Time.time : (res.status || ''),
    }));
    const flRes = results.find(r => r.FastestLap && r.FastestLap.rank === '1');
    last_race = {
      round: Number(lr.round),
      short_name: lr.raceName.replace('Grand Prix', 'GP').trim(),
      country: lr.Circuit.Location.country,
      circuit: lr.Circuit.circuitName,
      circuit_id: jCircuit(lr.Circuit.circuitId),
      start_utc: lr.date + 'T' + (lr.time || '12:00:00Z'),
      podium,
      fastest_lap: flRes ? {
        driver: `${flRes.Driver.givenName.charAt(0)}. ${flRes.Driver.familyName}`,
        time: flRes.FastestLap.Time.time,
        lap: flRes.FastestLap.lap,
      } : null,
      qualifying: null,
    };
  }

  return res.status(200).json({
    next_race,
    schedule,
    drivers,
    constructors,
    last_race,
    _fetched_at_utc: new Date().toISOString(),
    _stale: false,
  });
}

// --- Vercel handler entry point ---
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  try {
    const { driver } = req.query;
    if (driver) {
      return await handleDriver(driver, res);
    }
    return await handleStandings(res);
  } catch (err) {
    console.error('F1 proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
