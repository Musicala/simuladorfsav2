'use strict';

/**
 * calculator.js — FSA · Calculadora Valor/Hora (2026) — v2.4
 *
 * Qué mejora (sin romper lo que ya tienen):
 * ✅ Mantiene compatibilidad con app.js actual (mismos campos + extras)
 * ✅ Añade explicaciones/auditoría listas para UI (sin obligar a mostrarlas)
 * ✅ Expone horas del periodo (hoursPeriod) y métricas de impacto COP por tasas
 * ✅ Mantiene “horas reales docentes” como cálculo interno (weeklyContractHours),
 *    pero NO obliga a que la UI lo muestre. Ustedes mandan.
 *
 * Nota: Si el frontend no usa los nuevos campos, no pasa nada.
 */

/* ============================================================================
   Config
============================================================================ */

export const DEFAULT_CFG = {
  // Horizonte (Mar–Nov)
  MONTHS: 9,

  // Conversión horas
  WEEKS_PER_MONTH: 4.33,

  // Referencia para prorratear overhead (100% carga)
  BASE_HOURS_WEEK: 120,

  // Piso mínimo de overhead imputado mensual (COP)
  OVERHEAD_FLOOR_MONTHLY: 0,

  // Factor operación: horas clase -> horas contrato/operación
  CONTRACT_FACTOR: 1.5,

  // Flags (para "reglas en config" tipo toggles)
  USE_CONTRACT_FACTOR: true,
  USE_ERROR_PCT: true,
  USE_MARGIN_PCT: true,
  USE_RETENTION_PCT: true,
  USE_OVERHEAD_FLOOR: true,

  // Docentes: contratos semanales -> costo mensual
  TEACHER_CONTRACTS: [
    { hours: 34, monthly: 3091008 },
    { hours: 30, monthly: 2784240 },
    { hours: 28, monthly: 2651600 },
    { hours: 24, monthly: 2341056 },
  ],

  // Horas sueltas (costo por hora contrato)
  LOOSE_HOURLY_COST: 106000,

  // % finales (UI los edita como %)
  ERROR_PCT: 1,
  MARGIN_PCT: 6,
  RETENTION_PCT: 6,

  /**
   * Overhead detallado (mensual)
   */
  OVERHEAD_ITEMS: [
    { category: 'Administrativo', name: 'Coordinación administrativa', monthly: 3939824 },
    { category: 'Académico',      name: 'Coordinación académica',      monthly: 3939824 },
    { category: 'Ventas',         name: 'Atención y asesoría',         monthly: 2724244 },
    { category: 'Calidad',        name: 'Supervisión y calidad',       monthly: 848700 },
    { category: 'Estructura',     name: 'Contabilidad',                monthly: 1100000 },
    { category: 'Estructura',     name: 'SG-SST',                      monthly: 600000 },
    { category: 'Estructura',     name: 'Pólizas',                     monthly: 633753 },
    { category: 'Estructura',     name: 'Herramientas (Google/IA)',    monthly: 200000 },
  ],

  /**
   * LEGACY (compatibilidad con UI que manda totales sueltos)
   */
  OVERHEAD_TOTALS: {
    coord_admin: 3939824,
    coord_academic: 3939824,
    customer_care: 2724244,
    quality: 848700,
    accounting: 1100000,
    sgsst: 600000,
    policies: 633753,
    tools: 200000,
  },
};

/* ============================================================================
   Utils
============================================================================ */

function nnum(x){
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function clamp(x, a, b){
  const v = nnum(x);
  return Math.min(b, Math.max(a, v));
}

function roundMoney(n){
  return Math.round(nnum(n));
}

export function moneyCOP(n){
  const v = Math.round(nnum(n));
  return v.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  });
}

function safeStr(x){
  return String(x ?? '').trim();
}

function normalizeCenterName(name){
  const s = safeStr(name);
  if (!s) return '';
  return s.toUpperCase().replace(/\s+/g, '_');
}

function sum(arr, fn){
  let acc = 0;
  for (const it of (arr || [])){
    acc += fn ? nnum(fn(it)) : nnum(it);
  }
  return acc;
}

function pickBool(val, fallback){
  if (typeof val === 'boolean') return val;
  return !!fallback;
}

/**
 * Merge seguro: respeta arrays (no los mezcla raro),
 * y mezcla OVERHEAD_TOTALS como objeto.
 */
function mergeCfg(overrides = {}){
  const cfg = {
    ...DEFAULT_CFG,
    ...overrides,
    OVERHEAD_TOTALS: {
      ...DEFAULT_CFG.OVERHEAD_TOTALS,
      ...(overrides.OVERHEAD_TOTALS || {}),
    },
  };

  // arrays: si viene override, lo usa tal cual
  if (Array.isArray(overrides.TEACHER_CONTRACTS)) cfg.TEACHER_CONTRACTS = overrides.TEACHER_CONTRACTS;
  if (Array.isArray(overrides.OVERHEAD_ITEMS)) cfg.OVERHEAD_ITEMS = overrides.OVERHEAD_ITEMS;

  // flags: asegurar booleano
  cfg.USE_CONTRACT_FACTOR = pickBool(overrides.USE_CONTRACT_FACTOR, DEFAULT_CFG.USE_CONTRACT_FACTOR);
  cfg.USE_ERROR_PCT = pickBool(overrides.USE_ERROR_PCT, DEFAULT_CFG.USE_ERROR_PCT);
  cfg.USE_MARGIN_PCT = pickBool(overrides.USE_MARGIN_PCT, DEFAULT_CFG.USE_MARGIN_PCT);
  cfg.USE_RETENTION_PCT = pickBool(overrides.USE_RETENTION_PCT, DEFAULT_CFG.USE_RETENTION_PCT);
  cfg.USE_OVERHEAD_FLOOR = pickBool(overrides.USE_OVERHEAD_FLOOR, DEFAULT_CFG.USE_OVERHEAD_FLOOR);

  return cfg;
}

/* ============================================================================
   Overhead (new + legacy adapter)
============================================================================ */

function legacyTotalsToItems(totals){
  const o = totals || {};
  const map = [
    ['Administrativo', 'Coordinación administrativa', o.coord_admin],
    ['Académico',      'Coordinación académica',      o.coord_academic],
    ['Ventas',         'Atención y asesoría',         o.customer_care],
    ['Calidad',        'Supervisión y calidad',       o.quality],
    ['Estructura',     'Contabilidad',                o.accounting],
    ['Estructura',     'SG-SST',                      o.sgsst],
    ['Estructura',     'Pólizas',                     o.policies],
    ['Estructura',     'Herramientas (Google/IA)',    o.tools],
  ];

  return map
    .map(([category, name, monthly]) => ({
      category,
      name,
      monthly: Math.max(0, nnum(monthly)),
      legacyKey: true,
    }))
    .filter(it => it.monthly > 0);
}

function normalizeOverheadItems(cfg){
  const items = Array.isArray(cfg?.OVERHEAD_ITEMS) ? cfg.OVERHEAD_ITEMS : [];
  const legacy = cfg?.OVERHEAD_TOTALS ? legacyTotalsToItems(cfg.OVERHEAD_TOTALS) : [];

  const cleanedNew = items
    .filter(Boolean)
    .map(it => ({
      category: safeStr(it.category) || 'Otros',
      name: safeStr(it.name) || 'Sin nombre',
      monthly: Math.max(0, nnum(it.monthly)),
      note: safeStr(it.note),
    }))
    .filter(it => it.monthly > 0);

  return cleanedNew.length ? cleanedNew : legacy;
}

function overheadBreakdown(items, share){
  const list = items || [];
  const s = clamp(share, 0, 1);

  const rows = list.map(it => {
    const total = roundMoney(it.monthly);
    const imputado = roundMoney(total * s);
    return {
      category: it.category,
      name: it.name,
      monthlyTotal: total,
      monthlyImputed: imputado,
      note: it.note || '',
    };
  });

  const totalMonthly = roundMoney(sum(rows, r => r.monthlyTotal));
  const imputedMonthlyRaw = roundMoney(sum(rows, r => r.monthlyImputed));

  // Agrupar por categoría
  const byCategoryMap = new Map();
  for (const r of rows){
    const key = r.category || 'Otros';
    const prev = byCategoryMap.get(key) || { category: key, monthlyTotal: 0, monthlyImputed: 0, items: [] };
    prev.monthlyTotal += r.monthlyTotal;
    prev.monthlyImputed += r.monthlyImputed;
    prev.items.push(r);
    byCategoryMap.set(key, prev);
  }

  const byCategory = Array.from(byCategoryMap.values())
    .map(c => ({
      category: c.category,
      monthlyTotal: roundMoney(c.monthlyTotal),
      monthlyImputed: roundMoney(c.monthlyImputed),
      items: c.items,
    }))
    .sort((a,b) => b.monthlyImputed - a.monthlyImputed);

  return {
    items: rows,
    byCategory,
    totalMonthly,
    imputedMonthlyRaw,
  };
}

/* ============================================================================
   Docentes
============================================================================ */

export function estimateTeachersCost(weeklyContractHours, cfg = DEFAULT_CFG){
  let remaining = Math.max(0, nnum(weeklyContractHours));

  let teachers = 0;
  let monthlyCost = 0;

  const breakdown = [];
  const teachersList = [];

  const contracts = (cfg.TEACHER_CONTRACTS || [])
    .map(c => ({ hours: nnum(c.hours), monthly: nnum(c.monthly) }))
    .filter(c => c.hours > 0 && c.monthly > 0)
    .sort((a,b) => b.hours - a.hours);

  for (const c of contracts){
    if (remaining <= 0) break;

    const count = Math.floor(remaining / c.hours);
    if (count > 0){
      const total = count * c.monthly;
      teachers += count;
      monthlyCost += total;
      remaining -= count * c.hours;

      breakdown.push({
        type: 'contract',
        contractHours: c.hours,
        count,
        monthlyEach: roundMoney(c.monthly),
        total: roundMoney(total),
        label: `${c.hours}h/sem`,
      });

      for (let i = 0; i < count; i++){
        teachersList.push({
          label: `Docente ${teachersList.length + 1}`,
          type: 'contract',
          contractHours: c.hours,
          monthly: roundMoney(c.monthly),
        });
      }
    }
  }

  // Residual => horas sueltas
  let looseHours = 0;
  let looseMonthly = 0;

  if (remaining > 0){
    looseHours = remaining;
    looseMonthly = looseHours * nnum(cfg.LOOSE_HOURLY_COST);

    // heurística: al menos 1 persona cubre lo suelto
    teachers += 1;
    monthlyCost += looseMonthly;

    breakdown.push({
      type: 'loose',
      contractHours: 0,
      count: 1,
      monthlyEach: roundMoney(cfg.LOOSE_HOURLY_COST),
      total: roundMoney(looseMonthly),
      label: `Horas sueltas (${Math.round(looseHours)}h/sem)`,
      note: `${Math.round(looseHours)}h/sem × ${moneyCOP(cfg.LOOSE_HOURLY_COST)}/h`,
    });

    teachersList.push({
      label: `Docente ${teachersList.length + 1}`,
      type: 'loose',
      contractHours: looseHours,
      monthly: roundMoney(looseMonthly),
      note: `Suelta: ${Math.round(looseHours)}h/sem × ${moneyCOP(cfg.LOOSE_HOURLY_COST)}/h`,
    });
  }

  return {
    teachers,
    monthlyCost: roundMoney(monthlyCost),
    breakdown,
    teachersList,
    looseHours: nnum(looseHours),
    looseMonthly: roundMoney(looseMonthly),
  };
}

/* ============================================================================
   Core
============================================================================ */

/**
 * computeScenario
 * @param {Array<{name:string,hours:number}>} centers - horas semanales de clase (efectivas)
 * @param {Object} cfgOverrides - overrides desde UI (applied)
 */
export function computeScenario(centers, cfgOverrides = {}){
  const cfg = mergeCfg(cfgOverrides);

  // Normaliza centros
  const listRaw = Array.isArray(centers) ? centers : [];
  const centersClean = listRaw
    .map(c => ({
      name: normalizeCenterName(c?.name),
      hours: Math.max(0, nnum(c?.hours)),
    }))
    .filter(c => c.name);

  const weeklyClassHours = sum(centersClean, c => c.hours);
  const jornadasWeek = weeklyClassHours / 4; // legacy: no obligan a mostrarlo

  const weeksPerMonth = Math.max(1, nnum(cfg.WEEKS_PER_MONTH) || DEFAULT_CFG.WEEKS_PER_MONTH);
  const hoursMonth = weeklyClassHours * weeksPerMonth;

  const months = Math.max(1, nnum(cfg.MONTHS) || DEFAULT_CFG.MONTHS);
  const hoursPeriod = hoursMonth * months;

  const baseHoursWeek = Math.max(1, nnum(cfg.BASE_HOURS_WEEK) || DEFAULT_CFG.BASE_HOURS_WEEK);
  const shareRaw = weeklyClassHours / baseHoursWeek;
  const share = clamp(shareRaw, 0, 1);

  // Factor operación (toggleable)
  const contractFactor = Math.max(1, nnum(cfg.CONTRACT_FACTOR) || DEFAULT_CFG.CONTRACT_FACTOR);
  const weeklyContractHours = cfg.USE_CONTRACT_FACTOR ? (weeklyClassHours * contractFactor) : weeklyClassHours;

  // Docentes
  const teachersInfo = estimateTeachersCost(weeklyContractHours, cfg);

  // Overhead
  const overheadItems = normalizeOverheadItems(cfg);
  const overheadRaw = overheadBreakdown(overheadItems, share);

  const overheadMonthlyRaw = overheadRaw.imputedMonthlyRaw;

  // Piso overhead (toggleable)
  const floor = Math.max(0, nnum(cfg.OVERHEAD_FLOOR_MONTHLY) || 0);
  const overheadMonthly = cfg.USE_OVERHEAD_FLOOR ? Math.max(floor, overheadMonthlyRaw) : overheadMonthlyRaw;

  // Costos internos
  const costMonthlyInternal = roundMoney(teachersInfo.monthlyCost + overheadMonthly);

  // Reglas % (toggleables)
  const err = cfg.USE_ERROR_PCT ? clamp(nnum(cfg.ERROR_PCT) / 100, 0, 0.99) : 0;
  const mar = cfg.USE_MARGIN_PCT ? clamp(nnum(cfg.MARGIN_PCT) / 100, 0, 0.99) : 0;
  const ret = cfg.USE_RETENTION_PCT ? clamp(nnum(cfg.RETENTION_PCT) / 100, 0, 0.99) : 0;

  // Costo objetivo (incluye error + margen)
  const targetNetNeeded = costMonthlyInternal * (1 + err) * (1 + mar);

  // Factura necesaria para que, tras retención, llegue el neto
  const requiredGrossMonthly = (1 - ret) > 0 ? (targetNetNeeded / (1 - ret)) : 0;

  // Tarifa mínima por hora de clase
  const hourlyMin = hoursMonth > 0 ? (requiredGrossMonthly / hoursMonth) : 0;

  // Total periodo (bruto requerido)
  const totalGross = requiredGrossMonthly * months;

  // Centros breakdown
  const centersBreakdown = centersClean
    .slice()
    .sort((a,b) => b.hours - a.hours || a.name.localeCompare(b.name))
    .map(c => ({
      name: c.name,
      weeklyHours: nnum(c.hours),
      monthHours: nnum(c.hours) * weeksPerMonth,
      shareWithinScenario: weeklyClassHours > 0 ? (nnum(c.hours) / weeklyClassHours) : 0,
    }));

  /* ========================= Auditoría / Explicaciones =========================
     Estos campos son para que el frontend pueda decir “qué está pasando”
     sin reinventarse fórmulas. Si no los usan, cero drama.
  ============================================================================ */

  const overheadTotalMusicala = roundMoney(overheadRaw.totalMonthly);
  const sharePct = Math.round(share * 100);

  // Impacto COP aproximado por tasa (en base al requerido bruto mensual)
  // OJO: esto es un “aporte” explicativo. La tasa se aplica en fórmula compuesta,
  // pero sirve para que el usuario vea órdenes de magnitud.
  const rateImpact = {
    margin: roundMoney(requiredGrossMonthly * mar),
    error: roundMoney(requiredGrossMonthly * err),
    retention: roundMoney(requiredGrossMonthly * ret),
  };

  const explain = {
    hours: {
      weeklyClassHours: roundMoney(weeklyClassHours),
      weeksPerMonth,
      months,
      hoursMonth: roundMoney(hoursMonth),
      hoursPeriod: roundMoney(hoursPeriod),
      note: 'Horas del escenario se basan en horas semanales efectivas de clase.',
    },
    share: {
      weeklyClassHours: roundMoney(weeklyClassHours),
      baseHoursWeek: roundMoney(baseHoursWeek),
      shareRaw,
      shareCapped: share,
      sharePct,
      formula: 'share = horasSemana / horasBaseSemana (capado 0–1)',
    },
    overhead: {
      totalMusicalaMonthly: overheadTotalMusicala,
      imputedMonthlyRaw: roundMoney(overheadMonthlyRaw),
      floorMonthly: roundMoney(floor),
      imputedMonthlyFinal: roundMoney(overheadMonthly),
      formula: 'overheadImputado = overheadTotal × share; luego aplica piso si está activo',
    },
    teachers: {
      weeklyClassHours: roundMoney(weeklyClassHours),
      contractFactor: contractFactor,
      useContractFactor: !!cfg.USE_CONTRACT_FACTOR,
      weeklyContractHours: roundMoney(weeklyContractHours),
      teachers: teachersInfo.teachers,
      monthlyCost: roundMoney(teachersInfo.monthlyCost),
      breakdown: teachersInfo.breakdown,
      note: 'Horas contrato = horas clase × factor (si está activo). Luego se cubre con contratos + sueltas.',
    },
    rates: {
      error: err,
      margin: mar,
      retention: ret,
      use: {
        USE_ERROR_PCT: !!cfg.USE_ERROR_PCT,
        USE_MARGIN_PCT: !!cfg.USE_MARGIN_PCT,
        USE_RETENTION_PCT: !!cfg.USE_RETENTION_PCT,
      },
      formula: 'targetNet = costo × (1+error) × (1+margen); gross = targetNet / (1-retención)',
      targetNetNeeded: roundMoney(targetNetNeeded),
      requiredGrossMonthly: roundMoney(requiredGrossMonthly),
      impactCOPApprox: rateImpact,
    },
    hourly: {
      hourlyMin: roundMoney(hourlyMin),
      formula: 'tarifaMin = requiredGrossMonthly / horasMes',
    }
  };

  return {
    // Inputs principales
    weeklyClassHours: nnum(weeklyClassHours),   // horas efectivas (lo que ustedes quieren)
    jornadasWeek: nnum(jornadasWeek),           // legacy (UI puede ignorarlo)
    hoursMonth: nnum(hoursMonth),
    hoursPeriod: nnum(hoursPeriod),
    share,

    // (interno) horas de operación usadas para docentes
    weeklyContractHours: nnum(weeklyContractHours),

    // Centros
    centers: centersBreakdown,

    // Docentes
    teachers: teachersInfo.teachers,
    teachersMonthly: roundMoney(teachersInfo.monthlyCost),
    teachersInfo,

    // Overhead
    overhead: {
      items: overheadRaw.items,
      byCategory: overheadRaw.byCategory,
      totalsMonthly: overheadTotalMusicala,
      imputedMonthlyRaw: roundMoney(overheadMonthlyRaw),
      floorMonthly: roundMoney(floor),
      imputedMonthlyFinal: roundMoney(overheadMonthly),
    },

    // Compatibilidad legacy
    overheadTotalsMonthly: overheadTotalMusicala,
    overheadMonthly: roundMoney(overheadMonthly),

    // Costos
    costMonthlyInternal,

    // Reglas (tasas aplicadas)
    rates: { error: err, margin: mar, retention: ret },

    // Resultados
    hourlyMin: roundMoney(hourlyMin),
    requiredGrossMonthly: roundMoney(requiredGrossMonthly),
    totalGross: roundMoney(totalGross),

    // Extras “para explicar”
    explain,

    meta: {
      months,
      weeksPerMonth,
      baseHoursWeek,
      contractFactor,
      overheadFloor: roundMoney(floor),
      flags: {
        USE_CONTRACT_FACTOR: !!cfg.USE_CONTRACT_FACTOR,
        USE_ERROR_PCT: !!cfg.USE_ERROR_PCT,
        USE_MARGIN_PCT: !!cfg.USE_MARGIN_PCT,
        USE_RETENTION_PCT: !!cfg.USE_RETENTION_PCT,
        USE_OVERHEAD_FLOOR: !!cfg.USE_OVERHEAD_FLOOR,
      },
      notes: [
        'Overhead imputado por share = horasSemana / horasBaseSemana (capado 0–1).',
        'Tarifa mínima: cubre costo interno + (error y margen opcionales), y compensa retención si está activa.',
        'hoursPeriod = horasMes × meses del periodo.',
      ],
    }
  };
}