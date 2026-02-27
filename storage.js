'use strict';

/* ============================================================================
   storage.js — Escenarios Simulador FSA (v2.6)

   Mejoras (sin drama):
   ✅ Presets SOLO si la key no existe (raw === null). Si guardas [] no vuelven.
   ✅ Migración robusta: limpia basura, normaliza centers, completa createdAt/summary
   ✅ Summary actualizado para calculator.js v2.2+ (hourlyMin, requiredGrossMonthly, totalGross)
   ✅ Soporta cfg opcional (cfgApplied recomendado; también acepta cfg)
   ✅ No revienta si computeScenario falla: fallback seguro
   ✅ Dedupe por id y sanitiza name/id para que la UI no se ponga intensa
============================================================================ */

import { computeScenario } from './calculator.js';

const KEY = 'fsa_sim_2026_scenarios_v1';

/* ============================================================================
   PRESETS INICIALES (solo primera vez real)
============================================================================ */

const DEFAULT_SCENARIOS = [
  {
    id: 'preset_basico',
    name: 'Preset Básico (Referencia)',
    centers: [
      { name:'ARROYO', hours:4 },
      { name:'BETANIA', hours:4 },
      { name:'JERUSALEN', hours:4 },
      { name:'LUCERO', hours:4 },
      { name:'SANTO_DOMINGO', hours:4 },
      { name:'PM_A', hours:4 },
      { name:'PM_B', hours:4 },
      { name:'GMMMC', hours:4 },
      { name:'ACAPULCO', hours:4 },
      { name:'SAN_JUAN', hours:4 }
    ]
  },
  {
    id: 'preset_medio',
    name: 'Preset Medio (Balanceado)',
    centers: [
      { name:'ARROYO', hours:8 },
      { name:'BETANIA', hours:8 },
      { name:'JERUSALEN', hours:8 },
      { name:'LUCERO', hours:8 },
      { name:'SANTO_DOMINGO', hours:8 },
      { name:'PM_A', hours:8 },
      { name:'PM_B', hours:8 },
      { name:'GMMMC', hours:8 },
      { name:'ACAPULCO', hours:8 },
      { name:'SAN_JUAN', hours:8 }
    ]
  },
  {
    id: 'preset_alto',
    name: 'Preset Alto (Operación Amplia)',
    centers: [
      { name:'ARROYO', hours:16 },
      { name:'BETANIA', hours:12 },
      { name:'JERUSALEN', hours:20 },
      { name:'LUCERO', hours:20 },
      { name:'SANTO_DOMINGO', hours:20 },
      { name:'PM_A', hours:4 },
      { name:'PM_B', hours:12 },
      { name:'GMMMC', hours:8 },
      { name:'ACAPULCO', hours:4 },
      { name:'SAN_JUAN', hours:4 }
    ]
  }
];

/* ============================================================================
   API pública
============================================================================ */

export function loadScenarios(){
  try{
    const raw = localStorage.getItem(KEY);

    // Primera vez real: no existe la key
    if (raw === null){
      const seeded = seedDefaultsOnce();
      saveScenarios(seeded);
      return seeded;
    }

    const parsed = raw ? safeJSONParse(raw, []) : [];
    const list = Array.isArray(parsed) ? parsed : [];

    const migrated = migrateIfNeeded(list);

    if (migrated.changed){
      saveScenarios(migrated.list);
      return migrated.list;
    }

    // Igual aplicamos dedupe liviano por si algo raro se coló sin “changed”
    const deduped = dedupeById(list);
    if (deduped.changed){
      saveScenarios(deduped.list);
      return deduped.list;
    }

    return list;
  }catch{
    // Si el storage está bloqueado o algo, devuelvo algo usable
    return [];
  }
}

export function saveScenarios(list){
  try{
    localStorage.setItem(KEY, JSON.stringify(Array.isArray(list) ? list : []));
  }catch{
    // Silencioso: la UI sigue funcionando sin persistencia
  }
}

export function addScenario(scn){
  const list = loadScenarios();

  const clean = sanitizeScenario(scn, { allowAutoId: true });
  const next = [clean, ...list];

  const deduped = dedupeById(next);
  saveScenarios(deduped.list);

  return deduped.list;
}

export function removeScenario(id){
  const target = String(id || '').trim();
  const list = loadScenarios().filter(s => String(s?.id || '').trim() !== target);
  saveScenarios(list);
  return list;
}

export function clearAll(){
  // Guardamos [] para que NO vuelvan presets (raw ya no será null)
  saveScenarios([]);
}

export function uid(prefix='scn'){
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
}

/* ============================================================================
   Seed + Migrate
============================================================================ */

function seedDefaultsOnce(){
  const nowISO = new Date().toISOString();

  return DEFAULT_SCENARIOS.map((p, idx) => {
    const centers = normalizeCenters(p.centers || []);
    const summary = computeSummarySafe(centers, null);

    return {
      id: String(p.id || `preset_${idx+1}`),
      name: String(p.name || `Preset ${idx+1}`),
      createdAt: nowISO,
      centers: cloneSafe(centers),
      summary,
    };
  });
}

function migrateIfNeeded(list){
  let changed = false;

  // Normaliza, completa, limpia
  const normalized = (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map((s) => {
      if (typeof s !== 'object'){
        changed = true;
        return null;
      }

      // Base sanita (pero NO generamos id nuevo si hay uno usable)
      const clean = sanitizeScenario(s, { allowAutoId: true });

      // cfg opcional: aceptamos cfgApplied o cfg
      const cfg = normalizeCfg(s.cfgApplied ?? s.cfg ?? null);

      if ((s.cfgApplied || s.cfg) && !cfg){
        // venía algo raro, lo limpiamos
        changed = true;
      }

      // createdAt
      if (!clean.createdAt){
        clean.createdAt = new Date().toISOString();
        changed = true;
      }

      // summary: recalcular si está viejo/incompleto
      const needsSummary = summaryNeedsRebuild(clean.summary);
      if (needsSummary){
        clean.summary = computeSummarySafe(clean.centers, cfg);
        changed = true;
      } else {
        // Completar campos faltantes sin destruir lo existente
        const base = computeSummarySafe(clean.centers, cfg);
        const merged = mergeSummary(clean.summary, base);
        if (!shallowEqual(clean.summary, merged)){
          clean.summary = merged;
          changed = true;
        }
      }

      // Guardar cfg si es válida (opcional)
      if (cfg){
        // estándar recomendado
        clean.cfgApplied = cfg;
        if ('cfg' in clean) delete clean.cfg;
      } else {
        if ('cfgApplied' in clean){ delete clean.cfgApplied; changed = true; }
        if ('cfg' in clean){ delete clean.cfg; changed = true; }
      }

      return clean;
    })
    .filter(Boolean);

  // Dedupe por id (si se repiten, se queda el primero (más nuevo))
  const deduped = dedupeById(normalized);
  if (deduped.changed) changed = true;

  return { list: deduped.list, changed };
}

/* ============================================================================
   Sanitizers
============================================================================ */

function sanitizeScenario(input, { allowAutoId } = { allowAutoId: true }){
  const s = (input && typeof input === 'object') ? input : {};

  let id = String(s.id || '').trim();
  if (!id && allowAutoId) id = uid('scn');

  let name = String(s.name || '').trim();
  if (!name) name = 'Escenario';

  // Evitar nombres absurdamente largos en UI
  if (name.length > 80) name = name.slice(0, 80).trim();

  const centers = normalizeCenters(Array.isArray(s.centers) ? s.centers : []);
  const createdAt = s.createdAt ? String(s.createdAt) : '';

  // Mantén lo demás por si luego lo usan, pero garantizamos lo esencial
  const out = {
    ...s,
    id,
    name,
    createdAt,
    centers: cloneSafe(centers),
  };

  // summary se maneja en migrate/add
  if (s.summary && typeof s.summary === 'object') out.summary = s.summary;

  return out;
}

function normalizeCenters(centers){
  return (centers || [])
    .map(c => ({
      name: String(c?.name || '').trim(),
      hours: Math.max(0, nnum(c?.hours || 0)),
    }))
    .filter(c => c.name);
}

function normalizeCfg(cfg){
  if (!cfg || typeof cfg !== 'object') return null;
  try{
    // Quita cosas no serializables
    return JSON.parse(JSON.stringify(cfg));
  }catch{
    return null;
  }
}

/* ============================================================================
   Summary
============================================================================ */

function computeSummarySafe(centers, cfg){
  try{
    const res = cfg ? computeScenario(centers, cfg) : computeScenario(centers);

    return {
      weeklyClassHours: nnum(res?.weeklyClassHours ?? sumHours(centers)),
      jornadasWeek: nnum(res?.jornadasWeek ?? approxJornadas(sumHours(centers))),
      teachers: nnum(res?.teachers ?? 0),

      hourlyMin: nnum(res?.hourlyMin ?? 0),
      costMonthlyInternal: nnum(res?.costMonthlyInternal ?? 0),
      requiredGrossMonthly: nnum(res?.requiredGrossMonthly ?? 0),
      totalGross: nnum(res?.totalGross ?? 0),

      sharePct: Math.round(nnum(res?.share ?? 0) * 100),
    };
  }catch{
    const h = sumHours(centers);
    return {
      weeklyClassHours: h,
      jornadasWeek: approxJornadas(h),
      teachers: 0,
      hourlyMin: 0,
      costMonthlyInternal: 0,
      requiredGrossMonthly: 0,
      totalGross: 0,
      sharePct: 0,
    };
  }
}

function summaryNeedsRebuild(summary){
  if (!summary || typeof summary !== 'object') return true;

  // legacy keys (viejos)
  if ('priceMonthly' in summary) return true;
  if ('totalPeriod' in summary) return true;

  // faltan claves esenciales
  if (!('hourlyMin' in summary)) return true;
  if (!('requiredGrossMonthly' in summary)) return true;

  return false;
}

function mergeSummary(current, base){
  const s = (current && typeof current === 'object') ? current : {};
  const b = base || {};

  return {
    weeklyClassHours: s.weeklyClassHours ?? b.weeklyClassHours,
    jornadasWeek: s.jornadasWeek ?? b.jornadasWeek,
    teachers: s.teachers ?? b.teachers,
    hourlyMin: s.hourlyMin ?? b.hourlyMin,
    costMonthlyInternal: s.costMonthlyInternal ?? b.costMonthlyInternal,
    requiredGrossMonthly: s.requiredGrossMonthly ?? b.requiredGrossMonthly,
    totalGross: s.totalGross ?? b.totalGross,
    sharePct: s.sharePct ?? b.sharePct,
  };
}

/* ============================================================================
   Dedupe + helpers
============================================================================ */

function dedupeById(list){
  const seen = new Set();
  const out = [];
  let changed = false;

  for (const s of (Array.isArray(list) ? list : [])){
    const id = String(s?.id || '').trim();
    if (!id){
      changed = true;
      continue;
    }
    if (seen.has(id)){
      changed = true;
      continue;
    }
    seen.add(id);
    out.push(s);
  }

  return { list: out, changed };
}

function sumHours(centers){
  return (centers || []).reduce((acc, c) => acc + nnum(c?.hours || 0), 0);
}

// Jornadas = bloques de 4h visibles (mantengo tu lógica)
function approxJornadas(weeklyHours){
  return Math.round((nnum(weeklyHours || 0) / 4) * 100) / 100;
}

function cloneSafe(obj){
  try{
    return structuredClone(obj);
  }catch{
    return JSON.parse(JSON.stringify(obj));
  }
}

function safeJSONParse(str, fallback){
  try{
    return JSON.parse(str);
  }catch{
    return fallback;
  }
}

function nnum(x){
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function shallowEqual(a, b){
  try{
    const ak = Object.keys(a || {});
    const bk = Object.keys(b || {});
    if (ak.length !== bk.length) return false;
    for (const k of ak){
      if (a[k] !== b[k]) return false;
    }
    return true;
  }catch{
    return false;
  }
}