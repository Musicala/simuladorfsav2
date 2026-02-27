'use strict';

import { computeScenario } from './calculator.js';
import { loadScenarios, addScenario, removeScenario, clearAll, uid } from './storage.js';

/* ============================================================================
   FSA · Valor por Hora (interno) — app.js v2.4
   ✅ NO rompe lo que ya tenían: misma estructura, mismos IDs existentes
   ✅ Quita “Jornadas por semana” del render (sin tocar el motor)
   ✅ Muestra horas semana / mes / periodo (si el motor no las da, las calcula)
   ✅ Share overhead explicado (números + fórmula)
   ✅ Márgenes/retenciones/error: % + COP (cuando es posible) + explicación
   ✅ Docentes: explicación “por qué sale” (y placeholders si falta data del motor)
   ✅ Mantiene: draft vs applied config + escenarios + desglose overhead
============================================================================ */

/* ========================= Defaults ========================= */
const DEFAULT_CENTER_NAMES = [
  'ARROYO','BETANIA','JERUSALEN','LUCERO','SANTO_DOMINGO','PM_A','PM_B','GMMMC','ACAPULCO','SAN_JUAN'
];

const HOURS_STEP = 4;

/* ========================= Local Storage keys ========================= */
const LS_KEYS = {
  CFG_APPLIED: 'fsa_cfg_applied_v1',
  CFG_DRAFT:   'fsa_cfg_draft_v1',
};

/* ========================= State ========================= */
let centers = DEFAULT_CENTER_NAMES.map(name => ({ name, hours: 0 }));
let lastComputed = null;
let rafToken = 0;

const state = {
  cfgApplied: null,  // manda en el cálculo
  cfgDraft: null,    // lo que el usuario edita
  cfgDirty: false,   // draft != applied
};

/* ========================= DOM ========================= */
const $ = (sel, root=document) => root.querySelector(sel);

const el = {
  centersList: $('#centersList'),
  btnAddCenter: $('#btnAddCenter'),

  // Summary KPIs (existentes + nuevos)
  kpiHours: $('#kpiHours'),
  kpiHoursMonth: $('#kpiHoursMonth'),
  kpiHoursPeriod: $('#kpiHoursPeriod'),

  // Eliminado visualmente (pero lo dejamos por compat si existe)
  kpiJornadas: $('#kpiJornadas'),

  // Applied percentages
  kpiSharePct: $('#kpiSharePct'),
  kpiShareExplain: $('#kpiShareExplain'),

  kpiErrorPct: $('#kpiErrorPct'),
  kpiRetentionPct: $('#kpiRetentionPct'),
  kpiTargetMarginPct: $('#kpiTargetMarginPct'),

  // NEW: valores COP para tasas
  kpiTargetMarginMoney: $('#kpiTargetMarginMoney'),
  kpiRetentionMoney: $('#kpiRetentionMoney'),
  kpiErrorMoney: $('#kpiErrorMoney'),

  // KPI principal + costos
  kpiHourlyMin: $('#kpiHourlyMin'),
  kpiCostMonthly: $('#kpiCostMonthly'),
  kpiOverheadMonthly: $('#kpiOverheadMonthly'),
  kpiTeachersMonthly: $('#kpiTeachersMonthly'),

  // NEW: explicaciones cortas en KPIs
  kpiCostExplain: $('#kpiCostExplain'),
  kpiOverheadExplain: $('#kpiOverheadExplain'),
  kpiTeachersExplain: $('#kpiTeachersExplain'),

  // Proposed
  inputProposedHourly: $('#inputProposedHourly'),
  kpiProfitMonthly: $('#kpiProfitMonthly'),
  kpiProfitExplain: $('#kpiProfitExplain'),
  kpiMarginPct: $('#kpiMarginPct'),
  kpiMarginMoney: $('#kpiMarginMoney'),

  // OPTIONAL: breakdown overhead
  overheadBox: $('#overheadBox'),
  overheadCats: $('#overheadCats'),
  overheadItems: $('#overheadItems'),
  overheadMeta: $('#overheadMeta'),

  // NEW: Auditoría / Explicaciones (panel)
  expShareHoursWeek: $('#expShareHoursWeek'),
  expShareBaseHoursWeek: $('#expShareBaseHoursWeek'),
  expSharePct: $('#expSharePct'),
  expShareImputed: $('#expShareImputed'),
  expShareNote: $('#expShareNote'),

  expOverheadTotalMusicala: $('#expOverheadTotalMusicala'),
  expOverheadImputed: $('#expOverheadImputed'),
  expOverheadSources: $('#expOverheadSources'),

  expTeachersClassHoursWeek: $('#expTeachersClassHoursWeek'),
  expTeachersContractHoursWeek: $('#expTeachersContractHoursWeek'),
  expTeachersCount: $('#expTeachersCount'),
  expTeachersMonthly: $('#expTeachersMonthly'),
  expTeachersBreakdown: $('#expTeachersBreakdown'),

  expMarginPct: $('#expMarginPct'),
  expMarginMoney: $('#expMarginMoney'),
  expErrorPct: $('#expErrorPct'),
  expErrorMoney: $('#expErrorMoney'),
  expRetentionPct: $('#expRetentionPct'),
  expRetentionMoney: $('#expRetentionMoney'),
  expRatesTotalMoney: $('#expRatesTotalMoney'),
  expRatesNote: $('#expRatesNote'),

  // Scenarios
  btnSaveScenario: $('#btnSaveScenario'),
  btnScenarios: $('#btnScenarios'),
  dlg: $('#dlgScenarios'),
  btnCloseDlg: $('#btnCloseDlg'),
  scenarioName: $('#scenarioName'),
  btnConfirmSave: $('#btnConfirmSave'),
  scenariosList: $('#scenariosList'),
  btnClearAll: $('#btnClearAll'),

  // Config buttons/badge
  btnApplyConfig: $('#btnApplyConfig'),
  btnDiscardConfig: $('#btnDiscardConfig'),
  cfgDirtyBadge: $('#cfgDirtyBadge'),

  // Config inputs
  cfgBaseHoursWeek: $('#cfgBaseHoursWeek'),
  cfgWeeksPerMonth: $('#cfgWeeksPerMonth'),
  cfgMonths: $('#cfgMonths'),
  cfgContractFactor: $('#cfgContractFactor'),
  cfgMarginPct: $('#cfgMarginPct'),
  cfgRetentionPct: $('#cfgRetentionPct'),
  cfgErrorPct: $('#cfgErrorPct'),
  cfgOverheadFloor: $('#cfgOverheadFloor'),

  // Legacy overhead inputs
  cfgCoordAdmin: $('#cfgCoordAdmin'),
  cfgCoordAcademic: $('#cfgCoordAcademic'),
  cfgCustomerCare: $('#cfgCustomerCare'),
  cfgQuality: $('#cfgQuality'),
  cfgAccounting: $('#cfgAccounting'),
  cfgSgsst: $('#cfgSgsst'),
  cfgPolicies: $('#cfgPolicies'),
  cfgTools: $('#cfgTools'),
};

/* ========================= Formatting ========================= */
const NF = new Intl.NumberFormat('es-CO');

function fmtNumber(n){
  const v = Math.round(Number(n || 0));
  return NF.format(Number.isFinite(v) ? v : 0);
}

function fmtMoney(n){
  const v = Math.round(Number(n || 0));
  return `$ ${NF.format(Number.isFinite(v) ? v : 0)}`;
}

/**
 * Permite pegar números tipo:
 *  3.939.824
 *  3,939,824
 *  3939824
 */
function parseHumanNumber(v){
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  if (!s) return 0;

  const cleaned = s
    .replace(/\s+/g,'')
    .replace(/\.(?=\d{3}(\D|$))/g,'')   // puntos de miles
    .replace(/,(?=\d{3}(\D|$))/g,'')    // comas de miles
    .replace(/[^0-9.-]/g,'');           // fuera símbolos

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function normalizeName(name){
  const n = String(name ?? '').trim();
  if (!n) return '';
  return n.toUpperCase().replace(/\s+/g, '_');
}

function clampHours(n){
  const v = Math.max(0, parseHumanNumber(n));
  return Math.round(v / HOURS_STEP) * HOURS_STEP;
}

function getTotalWeeklyHours(list = centers){
  return (list || []).reduce((acc, c) => acc + (Number(c?.hours) || 0), 0);
}

function escapeHtml(str){
  return String(str ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'", '&#039;');
}

function deepClone(obj){
  return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

function stableStringify(obj){
  // suficiente para comparar configs simples
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function safeText(node, text){
  if (!node) return;
  node.textContent = (text === undefined || text === null || text === '') ? '—' : String(text);
}

function sumOverheadTotals(cfg){
  const t = cfg?.OVERHEAD_TOTALS || {};
  return Object.values(t).reduce((a, v) => a + (Number(v) || 0), 0);
}

/* ========================= Config (UI <-> cfg) ========================= */
function buildCfgFromUI(){
  const get = (node, fallback=0) => node ? parseHumanNumber(node.value) : fallback;

  return {
    BASE_HOURS_WEEK: Math.max(1, get(el.cfgBaseHoursWeek, 120)),
    WEEKS_PER_MONTH: Math.max(1, get(el.cfgWeeksPerMonth, 4.33)),
    MONTHS: Math.max(1, get(el.cfgMonths, 9)),
    ERROR_PCT: Math.max(0, get(el.cfgErrorPct, 1)),
    MARGIN_PCT: Math.max(0, get(el.cfgMarginPct, 6)),
    RETENTION_PCT: Math.max(0, get(el.cfgRetentionPct, 6)),
    OVERHEAD_FLOOR_MONTHLY: Math.max(0, get(el.cfgOverheadFloor, 0)),
    CONTRACT_FACTOR: Math.max(1, get(el.cfgContractFactor, 1.5)),

    OVERHEAD_TOTALS: {
      coord_admin: Math.max(0, get(el.cfgCoordAdmin, 0)),
      coord_academic: Math.max(0, get(el.cfgCoordAcademic, 0)),
      customer_care: Math.max(0, get(el.cfgCustomerCare, 0)),
      quality: Math.max(0, get(el.cfgQuality, 0)),
      accounting: Math.max(0, get(el.cfgAccounting, 0)),
      sgsst: Math.max(0, get(el.cfgSgsst, 0)),
      policies: Math.max(0, get(el.cfgPolicies, 0)),
      tools: Math.max(0, get(el.cfgTools, 0)),
    }
  };
}

function applyCfgToUI(cfg){
  if (!cfg) return;

  // numéricos
  if (el.cfgBaseHoursWeek) el.cfgBaseHoursWeek.value = String(cfg.BASE_HOURS_WEEK ?? 120);
  if (el.cfgWeeksPerMonth) el.cfgWeeksPerMonth.value = String(cfg.WEEKS_PER_MONTH ?? 4.33);
  if (el.cfgMonths) el.cfgMonths.value = String(cfg.MONTHS ?? 9);
  if (el.cfgContractFactor) el.cfgContractFactor.value = String(cfg.CONTRACT_FACTOR ?? 1.5);

  if (el.cfgMarginPct) el.cfgMarginPct.value = String(cfg.MARGIN_PCT ?? 6);
  if (el.cfgRetentionPct) el.cfgRetentionPct.value = String(cfg.RETENTION_PCT ?? 6);
  if (el.cfgErrorPct) el.cfgErrorPct.value = String(cfg.ERROR_PCT ?? 1);

  // dinero (mostrar con separadores)
  if (el.cfgOverheadFloor) el.cfgOverheadFloor.value = fmtNumber(cfg.OVERHEAD_FLOOR_MONTHLY ?? 0);

  const t = cfg.OVERHEAD_TOTALS || {};
  if (el.cfgCoordAdmin) el.cfgCoordAdmin.value = fmtNumber(t.coord_admin ?? 0);
  if (el.cfgCoordAcademic) el.cfgCoordAcademic.value = fmtNumber(t.coord_academic ?? 0);
  if (el.cfgCustomerCare) el.cfgCustomerCare.value = fmtNumber(t.customer_care ?? 0);
  if (el.cfgQuality) el.cfgQuality.value = fmtNumber(t.quality ?? 0);
  if (el.cfgAccounting) el.cfgAccounting.value = fmtNumber(t.accounting ?? 0);
  if (el.cfgSgsst) el.cfgSgsst.value = fmtNumber(t.sgsst ?? 0);
  if (el.cfgPolicies) el.cfgPolicies.value = fmtNumber(t.policies ?? 0);
  if (el.cfgTools) el.cfgTools.value = fmtNumber(t.tools ?? 0);
}

function cfgEquals(a,b){
  if (!a || !b) return false;
  try{
    return stableStringify(a) === stableStringify(b);
  }catch{
    return false;
  }
}

/* ========================= Config persistence ========================= */
function loadCfg(key){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }catch{
    return null;
  }
}

function saveCfg(key, cfg){
  try{
    localStorage.setItem(key, JSON.stringify(cfg));
  }catch{
    // si el storage falla, igual seguimos (solo no persiste)
  }
}

/* ========================= Applied vs Draft UI behavior ========================= */
function setCfgDirty(isDirty){
  state.cfgDirty = !!isDirty;
  if (el.cfgDirtyBadge){
    el.cfgDirtyBadge.style.display = state.cfgDirty ? '' : 'none';
  }
  if (el.btnApplyConfig){
    el.btnApplyConfig.disabled = !state.cfgDirty;
  }
  if (el.btnDiscardConfig){
    el.btnDiscardConfig.disabled = !state.cfgDirty;
  }
}

function onConfigInputChanged(){
  // lo que está en pantalla es draft. No recalculamos aún.
  state.cfgDraft = buildCfgFromUI();
  saveCfg(LS_KEYS.CFG_DRAFT, state.cfgDraft);
  setCfgDirty(!cfgEquals(state.cfgDraft, state.cfgApplied));
}

function applyConfig(){
  // toma el draft (UI) y lo vuelve applied
  const next = buildCfgFromUI();
  state.cfgDraft = deepClone(next);
  state.cfgApplied = deepClone(next);

  saveCfg(LS_KEYS.CFG_DRAFT, state.cfgDraft);
  saveCfg(LS_KEYS.CFG_APPLIED, state.cfgApplied);

  setCfgDirty(false);
  update(); // ahora sí recalcula todo con applied
}

function discardConfig(){
  applyCfgToUI(state.cfgApplied);
  state.cfgDraft = deepClone(state.cfgApplied);
  saveCfg(LS_KEYS.CFG_DRAFT, state.cfgDraft);
  setCfgDirty(false);
}

/* ========================= Proposed calc ========================= */
function computeWithProposed(res, proposedHourly){
  const hourly = Math.max(0, parseHumanNumber(proposedHourly));
  const hoursMonth = Number(res?.hoursMonth || 0);

  // Si el motor ya calcula esto, usamos su rate; si no, usamos cfg aplicada
  const ret = Number(res?.rates?.retention || 0);
  const gross = hourly * hoursMonth;
  const net = gross * (1 - ret);

  const cost = Number(res?.costMonthlyInternal || 0);
  const profit = net - cost;
  const margin = net > 0 ? (profit / net) : 0;

  return { gross, net, profit, margin };
}

/* ========================= Render: Centers ========================= */
function renderCenters(){
  if (!el.centersList) return;

  const rows = centers.map((c, idx) => {
    const name = normalizeName(c.name) || `CENTRO_${idx+1}`;
    const hours = clampHours(c.hours);

    return `
      <div class="row" data-idx="${idx}">
        <div class="row-left">
          <div class="row-title">${escapeHtml(name)}</div>
          <div class="row-sub">${fmtNumber(hours)} h/sem</div>
        </div>

        <div class="row-right">
          <div class="stepper" role="group" aria-label="Horas">
            <button class="btn icon" data-act="dec" title="-${HOURS_STEP}">−</button>
            <div class="stepper-value">${fmtNumber(hours)}</div>
            <button class="btn icon" data-act="inc" title="+${HOURS_STEP}">+</button>
          </div>
          <button class="btn ghost" data-act="del" title="Eliminar">✕</button>
        </div>
      </div>
    `;
  }).join('');

  el.centersList.innerHTML = rows || `<div class="muted">Agrega centros para empezar.</div>`;
}

/* ========================= Render: Overhead breakdown (optional) ========================= */
function renderOverheadBreakdown(res){
  if (!res?.overhead) return;

  const overhead = res.overhead;
  const sharePct = Math.round((Number(res.share || 0)) * 100);

  if (el.overheadMeta){
    el.overheadMeta.textContent =
      `Share aplicado: ${sharePct}% · Overhead Musicala: ${fmtMoney(overhead.totalsMonthly)} · Imputado: ${fmtMoney(overhead.imputedMonthlyFinal)}`;
  }

  if (el.overheadCats){
    const cats = Array.isArray(overhead.byCategory) ? overhead.byCategory : [];
    el.overheadCats.innerHTML = !cats.length
      ? `<div class="muted">No hay overhead configurado.</div>`
      : cats.map(cat => `
        <div class="line">
          <div class="line-left">
            <div class="line-title">${escapeHtml(cat.category || 'Otros')}</div>
            <div class="line-sub">${fmtMoney(cat.monthlyTotal)} total Musicala</div>
          </div>
          <div class="line-right">
            <div class="money">${fmtMoney(cat.monthlyImputed)} imputado</div>
          </div>
        </div>
      `).join('');
  }

  if (el.overheadItems){
    const items = Array.isArray(overhead.items) ? overhead.items : [];
    if (!items.length){
      el.overheadItems.innerHTML = `<div class="muted">No hay items de overhead.</div>`;
    } else {
      const ordered = items.slice().sort((a,b) => (b.monthlyImputed - a.monthlyImputed) || String(a.name).localeCompare(String(b.name)));
      el.overheadItems.innerHTML = ordered.map(it => `
        <div class="line">
          <div class="line-left">
            <div class="line-title">${escapeHtml(it.name || 'Sin nombre')}</div>
            <div class="line-sub">${escapeHtml(it.category || 'Otros')} · ${fmtMoney(it.monthlyTotal)} total</div>
          </div>
          <div class="line-right">
            <div class="money">${fmtMoney(it.monthlyImputed)}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

/* ========================= Render helpers: explanation blocks ========================= */
function renderShareExplain(res, cfg){
  const weeklyHours = Number(res?.weeklyClassHours ?? getTotalWeeklyHours());
  const baseWeek = Number(cfg?.BASE_HOURS_WEEK || 120);
  const shareRaw = baseWeek > 0 ? (weeklyHours / baseWeek) : 0;
  const shareCapped = Math.max(0, Math.min(1, Number(res?.share ?? shareRaw)));

  const sharePct = Math.round(shareCapped * 100);

  safeText(el.kpiShareExplain, `share = ${fmtNumber(weeklyHours)} / ${fmtNumber(baseWeek)} = ${sharePct}%`);

  safeText(el.expShareHoursWeek, `${fmtNumber(weeklyHours)} h`);
  safeText(el.expShareBaseHoursWeek, `${fmtNumber(baseWeek)} h`);
  safeText(el.expSharePct, `${sharePct}%`);

  const overheadImputed = Number(res?.overhead?.imputedMonthlyFinal ?? res?.overheadMonthly ?? 0);
  safeText(el.expShareImputed, fmtMoney(overheadImputed));

  const floor = Number(cfg?.OVERHEAD_FLOOR_MONTHLY || 0);
  if (el.expShareNote){
    if (floor > 0){
      el.expShareNote.innerHTML =
        `Piso mínimo overhead: <strong>${fmtMoney(floor)}</strong> (si el share da menos, se ajusta al piso).`;
    } else {
      el.expShareNote.textContent = 'Sin piso mínimo overhead aplicado.';
    }
  }
}

function renderOverheadExplain(res, cfg){
  const totalMusicala = Number(res?.overhead?.totalsMonthly ?? sumOverheadTotals(cfg));
  const overheadImputed = Number(res?.overhead?.imputedMonthlyFinal ?? res?.overheadMonthly ?? 0);

  safeText(el.expOverheadTotalMusicala, fmtMoney(totalMusicala));
  safeText(el.expOverheadImputed, fmtMoney(overheadImputed));

  if (el.expOverheadSources){
    const t = cfg?.OVERHEAD_TOTALS || {};
    const lines = [
      ['Coord. administrativa', t.coord_admin],
      ['Coord. académica', t.coord_academic],
      ['Atención y asesoría', t.customer_care],
      ['Supervisión y calidad', t.quality],
      ['Contabilidad', t.accounting],
      ['SG-SST', t.sgsst],
      ['Pólizas', t.policies],
      ['Google One + IA', t.tools],
    ].filter(([,v]) => Number(v || 0) > 0);

    if (!lines.length){
      el.expOverheadSources.textContent = 'No hay items de overhead (legacy) configurados en este perfil.';
    } else {
      el.expOverheadSources.innerHTML = `
        <div class="muted" style="margin-bottom:8px;">
          Suma de ítems (mensual):
        </div>
        <ul style="margin:0; padding-left:18px;">
          ${lines.map(([label,v]) => `<li>${escapeHtml(label)}: <strong>${fmtMoney(v)}</strong></li>`).join('')}
        </ul>
      `;
    }
  }

  // Mini explicación en KPI
  if (el.kpiOverheadExplain){
    const sharePct = Math.round((Number(res?.share || 0)) * 100);
    el.kpiOverheadExplain.textContent = `Overhead imputado = overhead total × share (${sharePct}%) + piso (si aplica)`;
  }
}

function renderTeachersExplain(res, cfg){
  const weeklyClassHours = Number(res?.weeklyClassHours ?? getTotalWeeklyHours());
  const factor = Number(cfg?.CONTRACT_FACTOR || 1.5);
  const contractHoursWeek = Number(res?.contractHoursWeek ?? (weeklyClassHours * factor));

  safeText(el.expTeachersClassHoursWeek, `${fmtNumber(weeklyClassHours)} h`);
  safeText(el.expTeachersContractHoursWeek, `${fmtNumber(contractHoursWeek)} h`);

  // Si el motor trae teachers (count), lo usamos. Si no, intentamos inferir burdo por 34h (sin prometer exactitud)
  const teachersCount = Number(res?.teachers ?? 0);
  safeText(el.expTeachersCount, teachersCount > 0 ? fmtNumber(teachersCount) : '—');

  const teachersMonthly = Number(res?.teachersMonthly ?? 0);
  safeText(el.expTeachersMonthly, fmtMoney(teachersMonthly));

  // Breakdown (si el motor lo trae), si no, dejamos guía
  if (el.expTeachersBreakdown){
    const plan = res?.teachersPlan || res?.teacherPlan || null;
    if (plan && typeof plan === 'object'){
      // Aceptamos varias formas (array o objeto)
      if (Array.isArray(plan)){
        el.expTeachersBreakdown.innerHTML = `
          <ul style="margin:0; padding-left:18px;">
            ${plan.map(p => `<li>${escapeHtml(String(p))}</li>`).join('')}
          </ul>
        `;
      } else {
        const keys = Object.keys(plan);
        if (!keys.length){
          el.expTeachersBreakdown.textContent = 'Sin desglose de contratos disponible.';
        } else {
          el.expTeachersBreakdown.innerHTML = `
            <ul style="margin:0; padding-left:18px;">
              ${keys.map(k => `<li>${escapeHtml(k)}: <strong>${escapeHtml(plan[k])}</strong></li>`).join('')}
            </ul>
          `;
        }
      }
    } else {
      el.expTeachersBreakdown.textContent =
        'Desglose de contratos no disponible en el motor aún (cuando lo expongamos, aquí aparecerá “1x34h + 1x30h + sueltas…”).';
    }
  }

  if (el.kpiTeachersExplain){
    el.kpiTeachersExplain.textContent = `Horas contrato semana ≈ horas clase × factor (${factor}). Luego se cubre con reglas de contratos.`;
  }
}

function renderRatesExplain(res, cfg){
  const rates = res?.rates || {};
  const marginPct = Number(cfg?.MARGIN_PCT ?? 6) / 100;
  const errorPct = Number(cfg?.ERROR_PCT ?? 1) / 100;
  const retentionPct = Number(cfg?.RETENTION_PCT ?? 6) / 100;

  // Preferimos lo que devuelve el motor en decimales (si existe)
  const rMargin = Number(rates.margin ?? marginPct);
  const rError = Number(rates.error ?? errorPct);
  const rRet = Number(rates.retention ?? retentionPct);

  safeText(el.expMarginPct, `${Math.round(rMargin * 100)}%`);
  safeText(el.expErrorPct, `${Math.round(rError * 100)}%`);
  safeText(el.expRetentionPct, `${Math.round(rRet * 100)}%`);

  // Valores COP: los calculamos sobre el "gross needed" si el motor lo da. Si no, dejamos “—”
  // Idea: requiredGrossMonthly = costo / (1 - sumRates) (o similar) => de ahí el impacto en COP.
  const requiredGrossMonthly = Number(res?.requiredGrossMonthly ?? 0);
  const costMonthly = Number(res?.costMonthlyInternal ?? 0);

  // Si requiredGrossMonthly existe, el "impacto" de una tasa p es requiredGrossMonthly * p.
  // OJO: si la fórmula del motor es distinta, esto es aproximación explicativa.
  const canMoney = requiredGrossMonthly > 0;

  const mMoney = canMoney ? requiredGrossMonthly * rMargin : 0;
  const eMoney = canMoney ? requiredGrossMonthly * rError : 0;
  const rMoney = canMoney ? requiredGrossMonthly * rRet : 0;

  if (canMoney){
    safeText(el.expMarginMoney, fmtMoney(mMoney));
    safeText(el.expErrorMoney, fmtMoney(eMoney));
    safeText(el.expRetentionMoney, fmtMoney(rMoney));
    safeText(el.expRatesTotalMoney, fmtMoney(mMoney + eMoney + rMoney));
    if (el.expRatesNote){
      el.expRatesNote.textContent = `Base usada para estimar COP: requerido bruto mensual (${fmtMoney(requiredGrossMonthly)}). Costo interno: ${fmtMoney(costMonthly)}.`;
    }
  } else {
    safeText(el.expMarginMoney, '—');
    safeText(el.expErrorMoney, '—');
    safeText(el.expRetentionMoney, '—');
    safeText(el.expRatesTotalMoney, '—');
    if (el.expRatesNote){
      el.expRatesNote.textContent = 'Cuando el motor exponga “requiredGrossMonthly”, aquí se verán los COP exactos. Por ahora: solo %.';
    }
  }

  // En los KPIs del resumen (pequeños)
  safeText(el.kpiTargetMarginMoney, canMoney ? fmtMoney(mMoney) : '—');
  safeText(el.kpiErrorMoney, canMoney ? fmtMoney(eMoney) : '—');
  safeText(el.kpiRetentionMoney, canMoney ? fmtMoney(rMoney) : '—');
}

/* ========================= Render: Summary ========================= */
function setDashAll(){
  const dash = '—';

  [
    el.kpiHours, el.kpiHoursMonth, el.kpiHoursPeriod,
    el.kpiHourlyMin, el.kpiCostMonthly, el.kpiOverheadMonthly, el.kpiTeachersMonthly,
    el.kpiProfitMonthly, el.kpiMarginPct,
    el.kpiSharePct, el.kpiErrorPct, el.kpiRetentionPct, el.kpiTargetMarginPct,
    el.kpiShareExplain, el.kpiTargetMarginMoney, el.kpiRetentionMoney, el.kpiErrorMoney,
    el.kpiCostExplain, el.kpiOverheadExplain, el.kpiTeachersExplain, el.kpiProfitExplain, el.kpiMarginMoney
  ].forEach(n => { if (n) n.textContent = dash; });

  // Auditoría blocks
  [
    el.expShareHoursWeek, el.expShareBaseHoursWeek, el.expSharePct, el.expShareImputed,
    el.expOverheadTotalMusicala, el.expOverheadImputed,
    el.expTeachersClassHoursWeek, el.expTeachersContractHoursWeek, el.expTeachersCount, el.expTeachersMonthly,
    el.expMarginPct, el.expMarginMoney, el.expErrorPct, el.expErrorMoney, el.expRetentionPct, el.expRetentionMoney, el.expRatesTotalMoney
  ].forEach(n => { if (n) n.textContent = dash; });

  if (el.expShareNote) el.expShareNote.textContent = dash;
  if (el.expOverheadSources) el.expOverheadSources.textContent = dash;
  if (el.expTeachersBreakdown) el.expTeachersBreakdown.textContent = dash;
  if (el.expRatesNote) el.expRatesNote.textContent = dash;

  if (el.overheadMeta) el.overheadMeta.textContent = dash;
  if (el.overheadCats) el.overheadCats.innerHTML = '';
  if (el.overheadItems) el.overheadItems.innerHTML = '';
}

function renderSummary(res, cfg){
  const totalWeekly = getTotalWeeklyHours();
  if (totalWeekly <= 0){
    setDashAll();
    return;
  }

  // si el motor falló, al menos mostramos horas
  if (!res){
    safeText(el.kpiHours, fmtNumber(totalWeekly));
    safeText(el.kpiHoursMonth, '—');
    safeText(el.kpiHoursPeriod, '—');
    return;
  }

  const weeklyClassHours = Number(res.weeklyClassHours ?? totalWeekly);
  const weeksPerMonth = Number(cfg?.WEEKS_PER_MONTH || 4.33);
  const months = Number(cfg?.MONTHS || 9);

  // Horas: si el motor no las da, las calculamos
  const hoursMonth = Number(res.hoursMonth ?? (weeklyClassHours * weeksPerMonth));
  const hoursPeriod = Number(res.hoursPeriod ?? (hoursMonth * months));

  safeText(el.kpiHours, fmtNumber(weeklyClassHours));
  safeText(el.kpiHoursMonth, fmtNumber(hoursMonth));
  safeText(el.kpiHoursPeriod, fmtNumber(hoursPeriod));

  // Quitar jornadas: si existe el node, lo ocultamos para siempre
  if (el.kpiJornadas){
    const kpi = el.kpiJornadas.closest?.('.kpi');
    if (kpi) kpi.style.display = 'none';
  }

  // Porcentajes aplicados (si no vienen del motor, los sacamos de cfg)
  const share = Number(res.share ?? (cfg?.BASE_HOURS_WEEK ? (weeklyClassHours / cfg.BASE_HOURS_WEEK) : 0));
  const rates = res.rates || {};
  const rMargin = Number(rates.margin ?? (Number(cfg?.MARGIN_PCT ?? 6)/100));
  const rRet = Number(rates.retention ?? (Number(cfg?.RETENTION_PCT ?? 6)/100));
  const rErr = Number(rates.error ?? (Number(cfg?.ERROR_PCT ?? 1)/100));

  safeText(el.kpiSharePct, `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`);
  safeText(el.kpiTargetMarginPct, `${Math.round(rMargin * 100)}%`);
  safeText(el.kpiRetentionPct, `${Math.round(rRet * 100)}%`);
  safeText(el.kpiErrorPct, `${Math.round(rErr * 100)}%`);

  // KPI dinero principal
  safeText(el.kpiHourlyMin, fmtMoney(res.hourlyMin));
  safeText(el.kpiCostMonthly, fmtMoney(res.costMonthlyInternal));

  const overheadMonthly = Number(res.overhead?.imputedMonthlyFinal ?? res.overheadMonthly ?? 0);
  safeText(el.kpiOverheadMonthly, fmtMoney(overheadMonthly));

  safeText(el.kpiTeachersMonthly, fmtMoney(res.teachersMonthly));

  // Propuesta: si no la tocaron, iguala a mínima
  if (el.inputProposedHourly && !el.inputProposedHourly.dataset.touched){
    el.inputProposedHourly.value = fmtNumber(res.hourlyMin || 0);
  }

  // Recalcular utilidad con propuesta
  const proposed = parseHumanNumber(el.inputProposedHourly?.value || res.hourlyMin || 0);
  const p = computeWithProposed({ ...res, hoursMonth }, proposed);

  safeText(el.kpiProfitMonthly, fmtMoney(p.profit));
  safeText(el.kpiMarginPct, `${Math.round((p.margin || 0) * 100)}%`);

  if (el.kpiProfitExplain){
    // neto = bruto*(1-retenciones) y utilidad = neto - costo
    const retPct = Math.round((Number(rates.retention ?? rRet) || 0) * 100);
    el.kpiProfitExplain.textContent = `Neto = bruto × (1 - retenciones ${retPct}%). Utilidad = neto - costo interno.`;
  }
  if (el.kpiMarginMoney){
    // “margen en COP” no es estándar, pero el usuario lo pidió: lo damos como utilidad COP.
    el.kpiMarginMoney.textContent = `Utilidad: ${fmtMoney(p.profit)}`;
  }

  if (el.kpiCostExplain){
    el.kpiCostExplain.textContent = `Costo interno = docentes (${fmtMoney(res.teachersMonthly)}) + overhead imputado (${fmtMoney(overheadMonthly)}).`;
  }

  // Explicaciones “auditoría”
  renderShareExplain({ ...res, weeklyClassHours, hoursMonth }, cfg);
  renderOverheadExplain(res, cfg);
  renderTeachersExplain(res, cfg);
  renderRatesExplain({ ...res, requiredGrossMonthly: res.requiredGrossMonthly }, cfg);

  // Breakdown overhead (ya lo tenían)
  renderOverheadBreakdown(res);
}

/* ========================= Update loop ========================= */
function update(){
  if (rafToken) return;
  rafToken = requestAnimationFrame(updateNow);
}

function updateNow(){
  rafToken = 0;

  centers = centers.map(c => ({
    name: normalizeName(c?.name) || 'CENTRO',
    hours: clampHours(c?.hours),
  }));

  const cfg = state.cfgApplied || buildCfgFromUI();

  let res = null;
  try{
    res = computeScenario(centers, cfg);
  }catch(err){
    console.error('[computeScenario] falló', err);
    res = null;
  }

  lastComputed = res;
  renderCenters();
  renderSummary(res, cfg);
}

/* ========================= Events: Centers ========================= */
function onCentersClick(e){
  const row = e.target.closest('.row');
  if (!row) return;
  const idx = Number(row.dataset.idx);
  if (!Number.isFinite(idx)) return;

  const act = e.target?.dataset?.act;
  if (!act) return;

  if (act === 'inc'){
    centers[idx].hours = clampHours((centers[idx].hours || 0) + HOURS_STEP);
  } else if (act === 'dec'){
    centers[idx].hours = clampHours((centers[idx].hours || 0) - HOURS_STEP);
  } else if (act === 'del'){
    centers.splice(idx, 1);
  }
  update();
}

function onAddCenter(){
  const name = prompt('Nombre del centro (ej: LUCERO):', '');
  const n = normalizeName(name);
  if (!n) return;
  centers.push({ name: n, hours: 0 });
  update();
}

/* ========================= Scenarios ========================= */
function openDlg(){
  if (el.dlg?.showModal) el.dlg.showModal();
  else if (el.dlg) el.dlg.setAttribute('open','');
  renderScenariosList();
}

function closeDlg(){
  if (el.dlg?.close) el.dlg.close();
  else if (el.dlg) el.dlg.removeAttribute('open');
}

function renderScenariosList(){
  if (!el.scenariosList) return;
  const list = loadScenarios();

  if (!list.length){
    el.scenariosList.innerHTML = `<div class="muted">No hay escenarios guardados.</div>`;
    return;
  }

  el.scenariosList.innerHTML = list.map(s => `
    <div class="scenario" data-id="${escapeHtml(s.id)}">
      <div class="scenario-main">
        <div class="scenario-title">${escapeHtml(s.name || 'Escenario')}</div>
        <div class="scenario-sub">${fmtNumber((s.centers||[]).reduce((a,c)=>a+Number(c?.hours||0),0))} h/sem</div>
      </div>
      <div class="scenario-actions">
        <button class="btn" data-act="load">Cargar</button>
        <button class="btn ghost" data-act="del">Eliminar</button>
      </div>
    </div>
  `).join('');
}

function onScenariosClick(e){
  const box = e.target.closest('.scenario');
  if (!box) return;
  const id = box.dataset.id;
  const act = e.target?.dataset?.act;
  if (!id || !act) return;

  if (act === 'del'){
    removeScenario(id);
    renderScenariosList();
    return;
  }

  if (act === 'load'){
    const s = loadScenarios().find(x => x.id === id);
    if (!s) return;
    centers = (s.centers || []).map(c => ({ name: normalizeName(c.name), hours: clampHours(c.hours) }));
    closeDlg();
    update();
  }
}

function saveScenario(){
  const name = (el.scenarioName?.value || '').trim() || `Escenario ${new Date().toLocaleDateString('es-CO')}`;
  addScenario({
    id: uid(),
    name,
    centers: centers.map(c => ({ name: normalizeName(c.name), hours: clampHours(c.hours) })),
    createdAt: new Date().toISOString(),
  });
  if (el.scenarioName) el.scenarioName.value = '';
  renderScenariosList();
}

/* ========================= Pretty inputs (dots) ========================= */
function attachMoneyFormatters(){
  // Inputs de dinero (se muestran con separadores, sin $)
  const moneyInputs = [
    el.cfgOverheadFloor,
    el.cfgCoordAdmin, el.cfgCoordAcademic, el.cfgCustomerCare, el.cfgQuality,
    el.cfgAccounting, el.cfgSgsst, el.cfgPolicies, el.cfgTools,
    el.inputProposedHourly,
  ].filter(Boolean);

  moneyInputs.forEach(inp => {
    if (inp === el.inputProposedHourly){
      // propuesta sí recalcula
      inp.addEventListener('input', () => { inp.dataset.touched = '1'; update(); });
    } else {
      // config: solo marca cambios, no recalcula
      inp.addEventListener('input', onConfigInputChanged);
    }

    inp.addEventListener('blur', () => {
      const v = parseHumanNumber(inp.value);
      inp.value = fmtNumber(v);
      if (inp !== el.inputProposedHourly) onConfigInputChanged();
    });
  });

  // Inputs de %/parámetros (config)
  [
    el.cfgErrorPct, el.cfgMarginPct, el.cfgRetentionPct,
    el.cfgWeeksPerMonth, el.cfgBaseHoursWeek,
    el.cfgMonths, el.cfgContractFactor
  ]
    .filter(Boolean)
    .forEach(inp => inp.addEventListener('input', onConfigInputChanged));
}

/* ========================= Init config state ========================= */
function initConfig(){
  // 1) cargar applied (si no hay, tomamos UI como default)
  const applied = loadCfg(LS_KEYS.CFG_APPLIED);
  if (applied){
    state.cfgApplied = applied;
  } else {
    state.cfgApplied = buildCfgFromUI();
    saveCfg(LS_KEYS.CFG_APPLIED, state.cfgApplied);
  }

  // 2) cargar draft. si no hay, clonar applied
  const draft = loadCfg(LS_KEYS.CFG_DRAFT);
  state.cfgDraft = draft ? draft : deepClone(state.cfgApplied);

  // 3) pintar el draft en la UI
  applyCfgToUI(state.cfgDraft);

  // 4) estado sucio
  setCfgDirty(!cfgEquals(state.cfgDraft, state.cfgApplied));
}

/* ========================= Init ========================= */
function init(){
  // Centers
  el.centersList?.addEventListener('click', onCentersClick);
  el.btnAddCenter?.addEventListener('click', onAddCenter);

  // Config buttons
  el.btnApplyConfig?.addEventListener('click', applyConfig);
  el.btnDiscardConfig?.addEventListener('click', discardConfig);

  // Scenarios
  el.btnScenarios?.addEventListener('click', openDlg);
  el.btnCloseDlg?.addEventListener('click', closeDlg);

  el.dlg?.addEventListener('click', (e) => {
    const rect = el.dlg.getBoundingClientRect();
    const inDialog = (
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom
    );
    if (!inDialog) closeDlg();
  });

  el.scenariosList?.addEventListener('click', onScenariosClick);

  el.btnSaveScenario?.addEventListener('click', () => {
    if (el.scenarioName) el.scenarioName.focus();
    openDlg();
  });

  el.btnConfirmSave?.addEventListener('click', saveScenario);

  el.btnClearAll?.addEventListener('click', () => {
    if (!confirm('¿Borrar todos los escenarios guardados?')) return;
    clearAll();
    renderScenariosList();
  });

  attachMoneyFormatters();

  // Config init (applied/draft)
  initConfig();

  renderCenters();
  update();
}

init();