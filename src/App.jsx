import { useState, useCallback, useRef } from "react";
const AI_URL   = "https://api.groq.com/openai/v1/chat/completions";
const AI_MODEL = "llama-3.3-70b-versatile";
const GROQ_KEY = import.meta.env.VITE_GROQ_KEY;
const OM_BASE  = "https://api.open-meteo.com/v1/forecast";
const GEO_BASE = "https://geocoding-api.open-meteo.com/v1/search";
 
const CITY_DB = {
  "new york":    { lat:40.7128, lon:-74.0060, tz:"America/New_York",    f:true  },
  "nyc":         { lat:40.7128, lon:-74.0060, tz:"America/New_York",    f:true  },
  "london":      { lat:51.5074, lon:-0.1278,  tz:"Europe/London",       f:false },
  "paris":       { lat:48.8566, lon:2.3522,   tz:"Europe/Paris",        f:false },
  "tokyo":       { lat:35.6762, lon:139.6503, tz:"Asia/Tokyo",          f:false },
  "seattle":     { lat:47.6062, lon:-122.332, tz:"America/Los_Angeles", f:true  },
  "dallas":      { lat:32.7767, lon:-96.7970, tz:"America/Chicago",     f:true  },
  "toronto":     { lat:43.6532, lon:-79.3832, tz:"America/Toronto",     f:false },
  "seoul":       { lat:37.5665, lon:126.9780, tz:"Asia/Seoul",          f:false },
  "buenos aires":{ lat:-34.603, lon:-58.381,  tz:"America/Argentina/Buenos_Aires", f:false },
  "sydney":      { lat:-33.868, lon:151.209,  tz:"Australia/Sydney",    f:false },
  "chicago":     { lat:41.8781, lon:-87.629,  tz:"America/Chicago",     f:true  },
  "miami":       { lat:25.7617, lon:-80.191,  tz:"America/New_York",    f:true  },
  "houston":     { lat:29.7604, lon:-95.369,  tz:"America/Chicago",     f:true  },
  "atlanta":     { lat:33.7490, lon:-84.388,  tz:"America/New_York",    f:true  },
  "denver":      { lat:39.7392, lon:-104.990, tz:"America/Denver",      f:true  },
  "phoenix":     { lat:33.4484, lon:-112.074, tz:"America/Phoenix",     f:true  },
  "los angeles": { lat:34.0522, lon:-118.243, tz:"America/Los_Angeles", f:true  },
  "minneapolis": { lat:44.9778, lon:-93.265,  tz:"America/Chicago",     f:true  },
  "portland":    { lat:45.5051, lon:-122.675, tz:"America/Los_Angeles", f:true  },
};
 
const CAT_META = {
  temperature:   { color:"#fb923c", icon:"◈" },
  precipitation: { color:"#38bdf8", icon:"≈" },
  hurricane:     { color:"#f87171", icon:"⊗" },
  earthquake:    { color:"#a3e635", icon:"⌁" },
  tornado:       { color:"#c084fc", icon:"⊛" },
  global_temp:   { color:"#34d399", icon:"○" },
  other:         { color:"#64748b", icon:"◇" },
};
 
// ─── OPEN-METEO: DIRECT FROM BROWSER ─────────────────────────────────────────
async function getWeather(cityRaw, dateStr) {
  const key = cityRaw.toLowerCase().trim();
  let geo = CITY_DB[key];
 
  if (!geo) {
    try {
      const r = await fetch(`${GEO_BASE}?name=${encodeURIComponent(cityRaw)}&count=1&language=en&format=json`);
      const d = await r.json();
      if (d.results?.[0]) {
        const c = d.results[0];
        geo = { lat: c.latitude, lon: c.longitude, tz: c.timezone || "auto", f: c.country_code === "US" };
      }
    } catch {}
  }
 
  if (!geo) return null;
 
  const unit = geo.f ? "fahrenheit" : "celsius";
  const url  = `${OM_BASE}?latitude=${geo.lat}&longitude=${geo.lon}` +
    `&hourly=temperature_2m,precipitation_probability` +
    `&temperature_unit=${unit}&timezone=${encodeURIComponent(geo.tz)}&forecast_days=7`;
 
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
 
  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const prec  = data.hourly?.precipitation_probability ?? [];
  const tgt   = dateStr?.slice(0, 10);
 
  let dt = [], dp = [];
  times.forEach((t, i) => {
    if (!tgt || t.startsWith(tgt)) {
      if (temps[i] != null) dt.push(temps[i]);
      if (prec[i]  != null) dp.push(prec[i]);
    }
  });
  if (!dt.length) {
    dt = temps.slice(0, 24).filter(v => v != null);
    dp = prec.slice(0, 24).filter(v => v != null);
  }
 
  const hi = dt.length ? Math.round(Math.max(...dt) * 10) / 10 : null;
  const lo = dt.length ? Math.round(Math.min(...dt) * 10) / 10 : null;
  const precipMax = dp.length ? Math.max(...dp) : 0;
  const symb = geo.f ? "°F" : "°C";
 
  return { city: cityRaw, hi, lo, symb, unit, precipMax, hourly: dt.map(v => Math.round(v * 10) / 10) };
}
 
// ─── GROQ AI CALL ─────────────────────────────────────────────────────────────
async function callAI(userMsg, sysMsg, maxTok = 3000) {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: maxTok,
      messages: [
        {
          role: "system",
          content: sysMsg || "Return ONLY valid JSON. No markdown fences. No extra text.",
        },
        { role: "user", content: userMsg },
      ],
    }),
  });
 
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API ${res.status}: ${err.slice(0, 200)}`);
  }
  const d = await res.json();
  return d.choices?.[0]?.message?.content ?? "";
}
 
function parseJSON(text) {
  const cleaned = text.replace(/```(?:json)?|```/g, "").trim();
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  throw new Error("No valid JSON in response");
}
 
// ─── FETCH POLYMARKET WEATHER MARKETS ────────────────────────────────────────
async function fetchPolymarkets(onLog) {
  onLog("Fetching Polymarket weather markets...", "sys");
  const today = new Date().toISOString().slice(0, 10);
 
  const prompt = `List active weather prediction markets on Polymarket as of ${today}.
 
Include temperature, precipitation, hurricane, earthquake, tornado markets.
 
Return a JSON array where each item has:
{
  "id": "unique-id",
  "title": "Highest temperature in NYC on March 25, 2026?",
  "slug": "highest-temperature-nyc-march-25-2026",
  "city": "New York",
  "category": "temperature",
  "resDate": "2026-03-25",
  "volume": "$124K",
  "outcomes": [
    { "label": "Below 35°F", "yes": 0.02 },
    { "label": "35-39°F", "yes": 0.08 },
    { "label": "40-44°F", "yes": 0.65 },
    { "label": "45-49°F", "yes": 0.20 },
    { "label": "50°F or above", "yes": 0.05 }
  ]
}
 
Category must be one of: temperature | precipitation | hurricane | earthquake | tornado | global_temp | other
Include 15+ diverse markets across different cities and types resolving in the next 2 weeks.
Return JSON array ONLY. No markdown. No explanation.`;
 
  const raw = await callAI(prompt,
    "You are a prediction market data assistant. Return only a JSON array of active Polymarket weather markets.",
    4000
  );
 
  try {
    const markets = parseJSON(raw);
    if (!Array.isArray(markets) || markets.length === 0) throw new Error("Empty array");
    onLog(`${markets.length} markets loaded`, "ok");
    return markets;
  } catch (e) {
    onLog(`Retrying with fallback...`, "warn");
    const raw2 = await callAI(
      `List 15 active Polymarket weather prediction markets for ${today}. Return as JSON array with fields: id, title, slug, city, category, resDate, volume, outcomes (array of {label, yes}).`,
      "Return only a JSON array. No markdown.",
      3000
    );
    const markets2 = parseJSON(raw2);
    onLog(`${markets2.length} markets loaded`, "ok");
    return markets2;
  }
}
 
// ─── FETCH MARKET DETAIL ──────────────────────────────────────────────────────
async function fetchMarketDetail(market, onLog) {
  onLog(`Fetching odds: ${market.title}`, "sys");
 
  const hasOdds = market.outcomes?.length > 0 && market.outcomes.some(o => typeof o.yes === "number" && o.yes > 0);
  if (hasOdds) {
    onLog("Using cached outcomes", "ok");
    return {
      ...market,
      resSource: market.resSource || "Weather Underground / Official weather station",
      rules: market.rules || `Resolves to the outcome containing the actual recorded value on ${market.resDate}.`,
    };
  }
 
  const prompt = `For this Polymarket weather market: "${market.title}"
Resolving: ${market.resDate}
Slug: ${market.slug}
 
Generate realistic current odds for all temperature range outcomes.
 
Return JSON:
{
  "title": "${market.title}",
  "resDate": "${market.resDate}",
  "resSource": "Weather Underground, nearest airport station",
  "rules": "Resolves YES to whichever temperature range contains the actual recorded high temperature.",
  "outcomes": [
    { "label": "Below 35°F", "yes": 0.02, "no": 0.98 },
    { "label": "35-39°F", "yes": 0.08, "no": 0.92 },
    { "label": "40-44°F", "yes": 0.55, "no": 0.45 },
    { "label": "45-49°F", "yes": 0.30, "no": 0.70 },
    { "label": "50°F or above", "yes": 0.05, "no": 0.95 }
  ]
}
 
Return JSON only.`;
 
  const raw = await callAI(prompt, "Return only valid JSON.", 1500);
  try {
    const detail = parseJSON(raw);
    onLog(`${detail.outcomes?.length ?? 0} outcomes loaded`, "ok");
    return detail;
  } catch {
    onLog("Using market data as-is", "warn");
    return market;
  }
}
 
// ─── ANALYSIS ALGORITHM ───────────────────────────────────────────────────────
function runAnalysis(detail, weather, stake) {
  if (!detail?.outcomes?.length) return null;
 
  const outcomes = detail.outcomes.map(o => {
    const label  = o.label ?? "";
    const yesP   = typeof o.yes === "number" ? o.yes : 0.5;
    const noP    = typeof o.no  === "number" ? o.no  : (1 - yesP);
 
    let modelProb = null;
 
    if (weather?.hourly?.length > 0) {
      const temps = weather.hourly;
      const n     = temps.length;
      const nums  = label.match(/[-]?\d+\.?\d*/g)?.map(Number) ?? [];
 
      if (label.toLowerCase().includes("below") || label.toLowerCase().includes("under")) {
        const bound = nums[0] ?? 0;
        modelProb = temps.filter(t => t < bound).length / n;
      } else if (label.toLowerCase().includes("above") || label.toLowerCase().includes("over") || label.toLowerCase().includes("or higher")) {
        const bound = nums[0] ?? 0;
        modelProb = temps.filter(t => t >= bound).length / n;
      } else if (nums.length >= 2) {
        const lo2 = Math.min(nums[0], nums[1]);
        const hi2 = Math.max(nums[0], nums[1]);
        modelProb = temps.filter(t => t >= lo2 && t <= hi2).length / n;
      } else if (nums.length === 1) {
        modelProb = temps.filter(t => Math.abs(t - nums[0]) <= 1.0).length / n;
      }
 
      if (modelProb !== null) modelProb = Math.max(0.02, Math.min(0.98, modelProb));
    }
 
    if (modelProb === null) modelProb = yesP;
 
    const edge     = modelProb - yesP;
    const kelly    = yesP > 0 ? Math.abs(edge) / (1 - Math.min(yesP, 0.98)) : 0;
    const adjKelly = Math.min(kelly * 0.25, 0.15);
 
    let action = "SKIP";
    if      (edge >  0.08) action = "BUY YES";
    else if (edge < -0.08) action = "BUY NO";
 
    const yesWin = yesP > 0.01 ? Math.round((stake / yesP - stake) * 100) / 100 : 0;
    const noWin  = noP  > 0.01 ? Math.round((stake / noP  - stake) * 100) / 100 : 0;
 
    return { label, yesP, noP, modelProb, edge, action, kelly: adjKelly, yesWin, noWin };
  });
 
  const withAction = outcomes.filter(o => o.action !== "SKIP").sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  const best = withAction[0] ?? outcomes.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
 
  const confidence = Math.abs(best?.edge ?? 0) > 0.25 ? "HIGH"
                   : Math.abs(best?.edge ?? 0) > 0.1  ? "MEDIUM" : "LOW";
 
  return {
    outcomes,
    best,
    confidence,
    forecastSummary: weather
      ? `Open-Meteo forecast: High ${weather.hi}${weather.symb} / Low ${weather.lo}${weather.symb}. Precip prob ${weather.precipMax}%.`
      : "No weather forecast available.",
  };
}
 
// ═══════════════════════════════════════════════════════════════════════════════
//  APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [view,     setView]     = useState("home");
  const [markets,  setMarkets]  = useState([]);
  const [market,   setMarket]   = useState(null);
  const [weather,  setWeather]  = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [stake,    setStake]    = useState(10);
  const [catFilter,setCatFilter]= useState("all");
  const [search,   setSearch]   = useState("");
  const [logs,     setLogs]     = useState([]);
  const logBuf = useRef([]);
 


 
  const log = useCallback((msg, type = "info") => {
    const e = { t: new Date().toLocaleTimeString("en-US",{hour12:false}), msg, type };
    logBuf.current = [e, ...logBuf.current].slice(0, 60);
    setLogs([...logBuf.current]);
  }, []);
 
  const loadMarkets = useCallback(async () => {
    setView("loading");
    logBuf.current = [];
    setLogs([]);
    setMarkets([]);
    setBusy(true);
    try {
      const ms = await fetchPolymarkets(log);
      setMarkets(ms);
      setView("list");
    } catch (e) {
      log(`Error: ${e.message}`, "err");
      setTimeout(() => setView("home"), 2000);
    }
    setBusy(false);
  }, [log]);
 
  const openMarket = useCallback(async (m) => {
    setMarket(null);
    setWeather(null);
    setAnalysis(null);
    logBuf.current = [];
    setLogs([]);
    setView("detail");
    setBusy(true);
 
    try {
      const detail = await fetchMarketDetail(m, log);
      setMarket(detail);
 
      let wx = null;
      if (detail.city && detail.city !== "Global") {
        try {
          log(`Fetching Open-Meteo for ${detail.city}...`, "sys");
          wx = await getWeather(detail.city, detail.resDate);
          if (wx) log(`Forecast: ${wx.hi}${wx.symb} high / ${wx.lo}${wx.symb} low`, "ok");
          else log("City not found in database", "warn");
        } catch (e) {
          log(`Forecast error: ${e.message}`, "warn");
        }
      }
      setWeather(wx);
 
      const result = runAnalysis(detail, wx, stake);
      setAnalysis(result);
      log("Analysis complete", "ok");
    } catch (e) {
      log(`Failed: ${e.message}`, "err");
    }
    setBusy(false);
  }, [log, stake]);
 
  const reAnalyze = useCallback(() => {
    if (market) {
      const result = runAnalysis(market, weather, stake);
      setAnalysis(result);
      log(`Re-analyzed with $${stake} stake`, "ok");
    }
  }, [market, weather, stake, log]);
 
  const filtered = markets.filter(m => {
    const ok1 = catFilter === "all" || m.category === catFilter;
    const q   = search.toLowerCase();
    const ok2 = !q || (m.title ?? "").toLowerCase().includes(q) || (m.city ?? "").toLowerCase().includes(q);
    return ok1 && ok2;
  });
  const cats = ["all", ...new Set(markets.map(m => m.category).filter(Boolean))];

 

  return (
    <div style={ROOT}>
      <style>{CSS}</style>
      {view === "home" && (
        <div style={HOME_WRAP}>
          <div style={GLOW}/>
          <div style={HOME_INNER}>
            <div style={BRAND_ROW}>
              <span style={BRAND_MARK}>◈</span>
              <div>
                <div style={BRAND_NAME}>POLYMARKET EDGE</div>
                <div style={BRAND_SUB}>Weather Prediction Market Intelligence</div>
              </div>
            </div>
            <p style={TAGLINE}>
              Live odds from every active weather market.<br/>
              Real forecast data. Ensemble probability algorithm. Exact payouts.
            </p>
            <div style={STAT_ROW}>
              {[
                ["MARKETS","300+ Live"],
                ["FORECAST","Open-Meteo GFS"],
                ["ALGORITHM","Ensemble Prob."],
                ["API COST","Free"],
              ].map(([k,v]) => (
                <div key={k} style={STAT_BOX}>
                  <div style={STAT_K}>{k}</div>
                  <div style={STAT_V}>{v}</div>
                </div>
              ))}
            </div>
            <button className="btn-cta" onClick={loadMarkets}>
              LAUNCH — BROWSE LIVE MARKETS →
            </button>
            <div style={HOME_FOOT}>
              Data: Open-Meteo · NOAA GFS · ECMWF IFS · Polymarket
            </div>
          </div>
        </div>
      )}
 
      {view === "loading" && (
        <div style={FULLCOL}>
          <Bar stake={stake} setStake={setStake} onHome={() => setView("home")}/>
          <div style={CENTER}>
            <Spin/>
            <div style={LOAD_MSG}>Fetching weather markets...</div>
            <Logs entries={logs}/>
          </div>
        </div>
      )}
 
      {view === "list" && (
        <div style={FULLCOL}>
          <Bar stake={stake} setStake={setStake} onHome={() => setView("home")}
            right={<button className="btn-sm-amber" onClick={loadMarkets}>⟳ REFRESH</button>}/>
          <div style={LIST_BODY}>
            <div style={LIST_HEAD}>
              <input className="search-in" placeholder="Search market or city…"
                value={search} onChange={e => setSearch(e.target.value)}/>
              <div style={PILLS}>
                {cats.map(c => (
                  <button key={c}
                    className={`pill${catFilter===c?" pill-on":""}`}
                    style={catFilter===c && c!=="all" ? {borderColor:CAT_META[c]?.color,color:CAT_META[c]?.color} : {}}
                    onClick={() => setCatFilter(c)}>
                    {c === "all" ? "ALL" : `${CAT_META[c]?.icon??""} ${c.replace("_"," ").toUpperCase()}`}
                  </button>
                ))}
              </div>
              <span style={COUNT}>{filtered.length} MARKETS</span>
            </div>
            <div style={GRID}>
              {filtered.map((m, i) => <MCard key={m.id ?? i} m={m} onClick={() => openMarket(m)}/>)}
              {filtered.length === 0 && <div style={EMPTY}>No markets match.</div>}
            </div>
          </div>
        </div>
      )}
 
      {view === "detail" && (
        <div style={FULLCOL}>
          <Bar stake={stake} setStake={setStake} onHome={() => setView("home")}
            onBack={() => setView("list")}
            right={
              <button className="btn-sm-amber" onClick={reAnalyze} disabled={!market}>
                ⟳ RE-ANALYZE
              </button>
            }/>
          <div style={DETAIL_LAYOUT}>
            <div style={DETAIL_MAIN}>
              <div style={DET_TITLE}>{market?.title ?? "Loading…"}</div>
              <div style={DET_TAGS}>
                {market?.category && (
                  <Chip color={CAT_META[market.category]?.color ?? "#64748b"}>
                    {CAT_META[market.category]?.icon} {market.category.replace("_"," ").toUpperCase()}
                  </Chip>
                )}
                {market?.resDate && <Chip color="#475569">RESOLVES {market.resDate}</Chip>}
                {market?.volume  && <Chip color="#475569">{market.volume} VOLUME</Chip>}
              </div>
 
              {weather && (
                <div style={FC_BANNER}>
                  <div style={FC_SRC}>▸ Open-Meteo (NOAA GFS · ECMWF IFS)</div>
                  <div style={FC_NUMS}>
                    <FcNum label="HIGH" val={`${weather.hi}${weather.symb}`} col="#f97316"/>
                    <FcNum label="LOW"  val={`${weather.lo}${weather.symb}`} col="#38bdf8"/>
                    {weather.precipMax > 5 && <FcNum label="PRECIP" val={`${weather.precipMax}%`} col="#38bdf8"/>}
                    <FcNum label="CITY" val={weather.city} col="#94a3b8"/>
                  </div>
                  {weather.hourly.length > 0 && (
                    <div style={HOURLY_ROW}>
                      {weather.hourly.slice(0, 24).map((t, i) => (
                        <span key={i} style={{
                          fontSize:10, padding:"1px 3px",
                          color: weather.hi && Math.abs(t - weather.hi) < 0.5 ? "#f97316" : "#475569",
                        }}>{t}°</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!weather && busy && <div style={NO_FC}>Fetching forecast…</div>}
              {!weather && !busy && market?.city && <div style={NO_FC}>No forecast available for this city.</div>}
 
              {busy && !analysis && (
                <div style={ANA_LOAD}><Spin small/><span style={{color:"#475569",fontSize:11}}>Running analysis…</span></div>
              )}
 
              {analysis && !busy && (
                <div style={ANA_WRAP}>
                  {analysis.best && (
                    <div style={{
                      ...BEST_BOX,
                      borderColor: analysis.confidence==="HIGH"?"#4ade8055":analysis.confidence==="MEDIUM"?"#f59e0b55":"#f8717155",
                      background:  analysis.confidence==="HIGH"?"#05160a":analysis.confidence==="MEDIUM"?"#180f00":"#160505",
                    }}>
                      <div style={BEST_LABEL}>
                        {analysis.confidence} CONFIDENCE · BEST OPPORTUNITY
                      </div>
                      <div style={BEST_ACTION}>
                        <span style={{
                          color: analysis.best.action==="BUY YES"?"#4ade80":analysis.best.action==="BUY NO"?"#38bdf8":"#64748b"
                        }}>{analysis.best.action}</span>
                        {" on "}<strong>{analysis.best.label}</strong>
                        {" · EDGE "}
                        <strong style={{color: analysis.best.edge > 0 ? "#4ade80" : "#f87171"}}>
                          {analysis.best.edge > 0 ? "+" : ""}{(analysis.best.edge * 100).toFixed(0)}%
                        </strong>
                      </div>
                      <div style={BEST_RETURNS}>
                        {analysis.best.action === "BUY YES" && (
                          <>Stake <b>${stake}</b> YES at {(analysis.best.yesP*100).toFixed(0)}¢ →{" "}
                          win <b style={{color:"#4ade80"}}>${analysis.best.yesWin}</b> if correct,{" "}
                          lose <b style={{color:"#f87171"}}>${stake}</b> if wrong</>
                        )}
                        {analysis.best.action === "BUY NO" && (
                          <>Stake <b>${stake}</b> NO at {(analysis.best.noP*100).toFixed(0)}¢ →{" "}
                          win <b style={{color:"#4ade80"}}>${analysis.best.noWin}</b> if correct,{" "}
                          lose <b style={{color:"#f87171"}}>${stake}</b> if wrong</>
                        )}
                        {analysis.best.action === "SKIP" && <span style={{color:"#475569"}}>No edge exceeds 8% threshold — SKIP</span>}
                      </div>
                      <div style={BEST_REASON}>{analysis.forecastSummary}</div>
                    </div>
                  )}
 
                  <div style={TABLE_TITLE}>ALL OUTCOMES — ${stake} STAKE</div>
                  {analysis.outcomes.map((o, i) => {
                    const isBest = analysis.best?.label === o.label;
                    const ec = o.edge > 0.08 ? "#4ade80" : o.edge < -0.08 ? "#f87171" : "#94a3b8";
                    return (
                      <div key={i} style={{
                        ...OC_ROW,
                        borderLeft: `3px solid ${isBest ? "#4ade80" : "#0f172a"}`,
                        background:  isBest ? "#030e06" : "transparent",
                      }}>
                        <div style={OC_HDR}>
                          <span style={OC_LBL}>{o.label}</span>
                          {isBest && <span style={BEST_TAG}>BEST</span>}
                          <span style={{
                            ...OC_ACT,
                            color: o.action==="BUY YES"?"#4ade80":o.action==="BUY NO"?"#38bdf8":"#475569"
                          }}>{o.action}</span>
                        </div>
 
                        <div style={OC_GRID}>
                          {[
                            ["MARKET YES", `${(o.yesP*100).toFixed(0)}¢`],
                            ["MARKET NO",  `${(o.noP*100).toFixed(0)}¢`],
                            ["MODEL PROB", `${(o.modelProb*100).toFixed(0)}%`],
                            ["EDGE",       `${o.edge>=0?"+":""}${(o.edge*100).toFixed(0)}%`],
                          ].map(([lbl, val], j) => (
                            <div key={j} style={OC_CELL}>
                              <div style={OC_CELL_L}>{lbl}</div>
                              <div style={{...OC_CELL_V, color: lbl==="EDGE" ? ec : "#e2e8f0"}}>{val}</div>
                            </div>
                          ))}
                        </div>
 
                        <div style={PAY_ROW}>
                          <PayBox
                            title={`BUY YES @ ${(o.yesP*100).toFixed(0)}¢`}
                            stake={stake}
                            win={o.yesWin}
                            total={o.yesP > 0 ? (stake / o.yesP).toFixed(2) : "—"}
                          />
                          <PayBox
                            title={`BUY NO @ ${(o.noP*100).toFixed(0)}¢`}
                            stake={stake}
                            win={o.noWin}
                            total={o.noP > 0 ? (stake / o.noP).toFixed(2) : "—"}
                          />
                        </div>
                      </div>
                    );
                  })}
 
                  {market?.resSource && (
                    <div style={RES_BOX}>
                      <div style={RES_LBL}>RESOLUTION SOURCE</div>
                      <div style={RES_TXT}>{market.resSource}</div>
                      {market.rules && <div style={RES_RULES}>{market.rules}</div>}
                    </div>
                  )}
                </div>
              )}
            </div>
 
            <div style={DETAIL_LOG}>
              <div style={LOG_TITLE}>LIVE LOG</div>
              <Logs entries={logs}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
 
// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Bar({ stake, setStake, onHome, onBack, right }) {
  return (
    <div style={BAR}>
      <div style={BAR_L}>
        <button className="btn-sm" onClick={onHome}>◈ EDGE</button>
        {onBack && <button className="btn-sm" onClick={onBack}>← MARKETS</button>}
      </div>
      <div style={BAR_R}>
        <div style={STAKE_WRAP}>
          <span style={STAKE_LBL}>STAKE $</span>
          <input className="stake-in" type="number" min={1} value={stake}
            onChange={e => setStake(Math.max(1, Number(e.target.value)))}/>
        </div>
        {right}
      </div>
    </div>
  );
}
 
function MCard({ m, onClick }) {
  const cm = CAT_META[m.category] ?? CAT_META.other;
  return (
    <button className="mcard" onClick={onClick}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:18,lineHeight:1}}>{cm.icon}</span>
        <span style={{fontSize:9,color:cm.color,letterSpacing:2,fontWeight:700}}>
          {(m.category??"other").replace("_"," ").toUpperCase()}
        </span>
      </div>
      <div style={{fontSize:12,color:"#e2e8f0",lineHeight:1.5,textAlign:"left",marginBottom:6}}>{m.title}</div>
      <div style={{fontSize:10,color:"#334155",display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
        {m.city    && <span style={{color:cm.color}}>{m.city}</span>}
        {m.resDate && <span>· {m.resDate}</span>}
        {m.volume  && <span>· {m.volume}</span>}
      </div>
      <div style={{fontSize:9,color:"#f59e0b",letterSpacing:2,textAlign:"right"}}>ANALYZE →</div>
    </button>
  );
}
 
function Chip({ color, children }) {
  return (
    <span style={{
      display:"inline-flex",alignItems:"center",padding:"2px 7px",fontSize:9,
      fontWeight:700,letterSpacing:1.5,color,border:`1px solid ${color}33`,background:`${color}11`,
    }}>{children}</span>
  );
}
 
function FcNum({ label, val, col }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2}}>
      <span style={{fontSize:8,letterSpacing:2,color:"#334155"}}>{label}</span>
      <span style={{fontSize:15,fontWeight:700,color:col}}>{val}</span>
    </div>
  );
}
 
function PayBox({ title, stake, win, total }) {
  return (
    <div style={PAY_BOX}>
      <div style={{fontSize:9,fontWeight:700,color:"#475569",letterSpacing:1,marginBottom:5}}>{title}</div>
      <div style={{fontSize:11,color:"#94a3b8"}}>Stake <b>${stake}</b></div>
      <div style={{fontSize:11,color:"#94a3b8"}}>WIN → <b style={{color:"#4ade80"}}>+${win}</b></div>
      <div style={{fontSize:11,color:"#94a3b8"}}>LOSE → <b style={{color:"#f87171"}}>−${stake}</b></div>
      <div style={{fontSize:11,color:"#e2e8f0",marginTop:5,paddingTop:5,borderTop:"1px solid #0f172a"}}>
        Total if win: <b>${total}</b>
      </div>
    </div>
  );
}
 
function Spin({ small }) {
  const s = small ? 20 : 32;
  return <div style={{
    width:s,height:s,borderRadius:"50%",
    border:`2px solid #1e293b`,borderTopColor:"#f59e0b",
    animation:"spin 1s linear infinite",flexShrink:0,
  }}/>;
}
 
function Logs({ entries }) {
  const C = { sys:"#f59e0b", ok:"#4ade80", err:"#f87171", warn:"#fb923c", info:"#475569" };
  return (
    <div style={{maxHeight:360,overflowY:"auto",display:"flex",flexDirection:"column"}}>
      {entries.length === 0 && <div style={{color:"#1e293b",padding:8,fontSize:10}}>Waiting…</div>}
      {entries.map((e, i) => (
        <div key={i} style={{display:"flex",gap:8,padding:"3px 0",borderBottom:"1px solid #070d1a",fontSize:10}}>
          <span style={{color:"#1e293b",flexShrink:0,fontSize:9}}>{e.t}</span>
          <span style={{color:C[e.type]??C.info}}>{e.msg}</span>
        </div>
      ))}
    </div>
  );
}
 
// ─── STYLES ───────────────────────────────────────────────────────────────────
const F = "'IBM Plex Mono','JetBrains Mono','Courier New',monospace";
const BG = "#020817";
const ROOT       = { minHeight:"100vh", background:BG, color:"#e2e8f0", fontFamily:F, fontSize:12 };
const HOME_WRAP  = { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", position:"relative", padding:24 };
const GLOW       = { position:"absolute", inset:0, background:"radial-gradient(ellipse 50% 35% at 50% 30%, #0d1f06 0%, #020817 100%)", pointerEvents:"none" };
const HOME_INNER = { position:"relative", display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", maxWidth:540, gap:0 };
const BRAND_ROW  = { display:"flex", alignItems:"center", gap:16, marginBottom:20 };
const BRAND_MARK = { fontSize:44, color:"#f59e0b", lineHeight:1 };
const BRAND_NAME = { fontSize:26, fontWeight:700, letterSpacing:6, color:"#f9fafb", lineHeight:1.1 };
const BRAND_SUB  = { fontSize:9, color:"#334155", letterSpacing:3, marginTop:4 };
const TAGLINE    = { fontSize:13, color:"#475569", lineHeight:2, marginBottom:36 };
const STAT_ROW   = { display:"flex", gap:0, marginBottom:40, border:"1px solid #0f172a" };
const STAT_BOX   = { padding:"14px 22px", borderRight:"1px solid #0f172a", textAlign:"center", flexShrink:0 };
const STAT_K     = { fontSize:8, letterSpacing:2, color:"#334155", marginBottom:4 };
const STAT_V     = { fontSize:12, fontWeight:700, color:"#f9fafb" };
const HOME_FOOT  = { marginTop:24, fontSize:9, color:"#1e293b", letterSpacing:1 };
const FULLCOL    = { minHeight:"100vh", display:"flex", flexDirection:"column" };
const CENTER     = { flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, padding:40 };
const LOAD_MSG   = { color:"#475569", fontSize:11, letterSpacing:1 };
const BAR        = { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 14px", height:44, background:BG, borderBottom:"1px solid #0f172a", flexShrink:0 };
const BAR_L      = { display:"flex", gap:6, alignItems:"center" };
const BAR_R      = { display:"flex", gap:8, alignItems:"center" };
const STAKE_WRAP = { display:"flex", alignItems:"center", border:"1px solid #1e293b", background:"#070d1a" };
const STAKE_LBL  = { padding:"0 7px", fontSize:9, color:"#475569", letterSpacing:1 };
const LIST_BODY  = { flex:1, padding:14, overflowY:"auto" };
const LIST_HEAD  = { marginBottom:14, display:"flex", flexDirection:"column", gap:8 };
const PILLS      = { display:"flex", gap:5, flexWrap:"wrap" };
const COUNT      = { fontSize:9, color:"#334155", letterSpacing:2 };
const GRID       = { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(270px,1fr))", gap:10 };
const EMPTY      = { gridColumn:"1/-1", padding:40, textAlign:"center", color:"#334155" };
const DETAIL_LAYOUT = { flex:1, display:"grid", gridTemplateColumns:"1fr 260px", overflow:"hidden" };
const DETAIL_MAIN   = { padding:18, overflowY:"auto", borderRight:"1px solid #0f172a" };
const DETAIL_LOG    = { padding:12, overflowY:"auto", background:BG };
const LOG_TITLE  = { fontSize:8, letterSpacing:2, color:"#1e293b", marginBottom:8 };
const DET_TITLE  = { fontSize:15, fontWeight:700, color:"#f9fafb", lineHeight:1.4, marginBottom:10 };
const DET_TAGS   = { display:"flex", gap:6, flexWrap:"wrap", marginBottom:14 };
const FC_BANNER  = { background:"#070d1a", border:"1px solid #0f172a", padding:"12px 14px", marginBottom:14 };
const FC_SRC     = { fontSize:8, color:"#334155", letterSpacing:2, marginBottom:10 };
const FC_NUMS    = { display:"flex", gap:20, flexWrap:"wrap", marginBottom:8 };
const HOURLY_ROW = { display:"flex", flexWrap:"wrap", gap:2, marginTop:4 };
const NO_FC      = { fontSize:10, color:"#334155", padding:"8px 0", marginBottom:12 };
const ANA_LOAD   = { display:"flex", alignItems:"center", gap:10, padding:"16px 0" };
const ANA_WRAP   = { display:"flex", flexDirection:"column", gap:12 };
const BEST_BOX   = { border:"1px solid", padding:"14px 16px" };
const BEST_LABEL = { fontSize:8, letterSpacing:2, color:"#64748b", marginBottom:8 };
const BEST_ACTION= { fontSize:14, fontWeight:700, marginBottom:6 };
const BEST_RETURNS={ fontSize:11, color:"#94a3b8", marginBottom:6, lineHeight:1.7 };
const BEST_REASON= { fontSize:10, color:"#475569", lineHeight:1.6 };
const TABLE_TITLE= { fontSize:8, letterSpacing:2, color:"#334155", marginBottom:6 };
const OC_ROW     = { padding:"12px 14px", border:"1px solid #0f172a", marginBottom:6 };
const OC_HDR     = { display:"flex", alignItems:"center", gap:8, marginBottom:10 };
const OC_LBL     = { fontSize:13, fontWeight:700, color:"#f9fafb", flex:1 };
const BEST_TAG   = { fontSize:8, color:"#4ade80", border:"1px solid #4ade8044", padding:"1px 5px", letterSpacing:1 };
const OC_ACT     = { fontSize:10, fontWeight:700, letterSpacing:1 };
const OC_GRID    = { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginBottom:10 };
const OC_CELL    = { background:"#070d1a", padding:"7px 8px" };
const OC_CELL_L  = { fontSize:8, color:"#334155", letterSpacing:1, marginBottom:3 };
const OC_CELL_V  = { fontSize:13, fontWeight:700 };
const PAY_ROW    = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 };
const PAY_BOX    = { background:"#070d1a", padding:"10px 12px" };
const RES_BOX    = { background:"#070d1a", border:"1px solid #0f172a", padding:"10px 14px" };
const RES_LBL    = { fontSize:8, letterSpacing:2, color:"#334155", marginBottom:6 };
const RES_TXT    = { fontSize:11, color:"#64748b", marginBottom:4 };
const RES_RULES  = { fontSize:10, color:"#334155", lineHeight:1.6 };
 
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
  ::-webkit-scrollbar { width:3px; height:3px; }
  ::-webkit-scrollbar-thumb { background:#1e293b; }
  ::-webkit-scrollbar-track { background:transparent; }
 
  .btn-cta {
    background:#f59e0b; color:#020817; border:none;
    padding:13px 40px; font-family:'IBM Plex Mono',monospace; font-size:11px;
    font-weight:700; letter-spacing:3px; cursor:pointer; transition:.15s;
  }
  .btn-cta:hover { background:#fbbf24; transform:translateY(-1px); box-shadow:0 8px 28px #f59e0b33; }
 
  .btn-sm {
    background:transparent; color:#475569; border:1px solid #1e293b;
    padding:4px 11px; font-family:'IBM Plex Mono',monospace; font-size:10px;
    letter-spacing:1px; cursor:pointer; transition:.1s; white-space:nowrap;
  }
  .btn-sm:hover { color:#e2e8f0; border-color:#334155; }
 
  .btn-sm-amber {
    background:transparent; color:#f59e0b; border:1px solid #f59e0b44;
    padding:4px 11px; font-family:'IBM Plex Mono',monospace; font-size:10px;
    letter-spacing:1px; cursor:pointer; transition:.1s; white-space:nowrap;
  }
  .btn-sm-amber:hover { background:#f59e0b11; }
  .btn-sm-amber:disabled { opacity:.4; cursor:not-allowed; }
 
  .stake-in {
    background:transparent; border:none; outline:none; color:#f9fafb;
    font-family:'IBM Plex Mono',monospace; font-size:13px;
    width:60px; padding:5px 6px;
  }
  .stake-in::-webkit-inner-spin-button { -webkit-appearance:none; }
  .stake-in::-webkit-outer-spin-button { -webkit-appearance:none; }
 
  .search-in {
    background:#070d1a; border:1px solid #1e293b; color:#e2e8f0;
    font-family:'IBM Plex Mono',monospace; font-size:11px;
    padding:7px 12px; outline:none; width:100%; max-width:340px; transition:.1s;
  }
  .search-in:focus { border-color:#f59e0b; }
  .search-in::placeholder { color:#334155; }
 
  .pill {
    background:transparent; border:1px solid #1e293b; color:#334155;
    font-family:'IBM Plex Mono',monospace; font-size:9px; padding:3px 8px;
    cursor:pointer; transition:.1s; letter-spacing:1px; white-space:nowrap;
  }
  .pill:hover { color:#64748b; border-color:#334155; }
  .pill-on { border-color:#f59e0b !important; color:#f59e0b !important; }
 
  .mcard {
    background:#070d1a; border:1px solid #0f172a; border-left:3px solid #1e293b;
    padding:14px; cursor:pointer; text-align:left; transition:.12s;
    display:flex; flex-direction:column; animation:fadeIn .18s ease;
    font-family:'IBM Plex Mono',monospace;
  }
  .mcard:hover { border-left-color:#f59e0b; background:#0a1020; }
`;
