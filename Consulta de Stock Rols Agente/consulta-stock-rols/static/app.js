// ============================================================
// i18n
// ============================================================
const SUPPORTED_LANGS = ['es', 'en', 'fr', 'de', 'it', 'nl'];
let CURRENT_LANG = (() => {
  const saved = localStorage.getItem('app-lang');
  return (saved && SUPPORTED_LANGS.includes(saved)) ? saved : 'es';
})();
const TRANSLATIONS = {};

function _i18nLookup(key, lang) {
  let val = TRANSLATIONS[lang];
  if (!val) return null;
  for (const part of key.split('.')) {
    if (val && typeof val === 'object') val = val[part];
    else return null;
    if (val === undefined) return null;
  }
  return val;
}

function t(key, params) {
  let val = _i18nLookup(key, CURRENT_LANG);
  if (val == null && CURRENT_LANG !== 'es') val = _i18nLookup(key, 'es');
  if (val == null) return key;  // ultimo recurso: la clave bruta
  if (typeof val === 'string' && params) {
    return val.replace(/\{(\w+)\}/g, (_, k) => params[k] !== undefined ? params[k] : `{${k}}`);
  }
  return val;
}

function tCount(keyBase, count, params) {
  const suffix = count === 1 ? '.one' : '.other';
  return t(keyBase + suffix, Object.assign({count}, params || {}));
}

async function loadTranslations(lang) {
  if (TRANSLATIONS[lang]) return;
  try {
    const res = await fetch(`/static/i18n/${lang}.json`);
    if (res.ok) TRANSLATIONS[lang] = await res.json();
  } catch (e) {
    console.warn(`[i18n] error cargando ${lang}.json`, e);
  }
}

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const v = t(el.getAttribute('data-i18n'));
    if (typeof v === 'string') el.textContent = v;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const v = t(el.getAttribute('data-i18n-html'));
    if (typeof v === 'string') el.innerHTML = v;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const v = t(el.getAttribute('data-i18n-placeholder'));
    if (typeof v === 'string') el.setAttribute('placeholder', v);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const v = t(el.getAttribute('data-i18n-title'));
    if (typeof v === 'string') el.setAttribute('title', v);
  });
}

function highlightActiveLangBtn() {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === CURRENT_LANG);
  });
}

const formGuiada = document.getElementById('form-guiada');
const formNL = document.getElementById('form-nl');
const iaBubble = document.getElementById('ia-bubble');
const userSection = document.getElementById('user-section');
const userBubble = document.getElementById('user-bubble');
const searchContext = document.getElementById('search-context');
const searchContextText = document.getElementById('search-context-text');

function showUserMessage(text) {
  userBubble.textContent = text;
  userSection.style.display = 'flex';
}

function hideUserMessage() {
  userSection.style.display = 'none';
  userBubble.textContent = '';
}

function fmtMeasure(n) {
  if (n == null) return '';
  return n === Math.trunc(n) ? `${n}` : Number(n).toFixed(2).replace('.', ',');
}

function formatSearchSummary(ref, ancho, largo, refCount) {
  if (!ref) return null;
  let head = ref;
  if (refCount && refCount > 1) {
    head += ' · ' + t('ui.search_context.ref_count', {count: refCount});
  }
  if (ancho != null && largo != null) return `${head} · ${fmtMeasure(ancho)} × ${fmtMeasure(largo)} m`;
  if (ancho != null) return `${head} · ${fmtMeasure(ancho)} m ancho`;
  if (largo != null) return `${head} · ${fmtMeasure(largo)} m`;
  return head;
}

// Ultima referencia valida; se envia al backend en consultas NL para
// que "mira en 4x3" tras "palma icon sand" siga refiriendose al mismo producto.
let lastRef = null;

// Ultima respuesta completa: usado para responder a "si" tras una oferta
// de alternativas, sin tener que hacer una nueva consulta (que perderia
// las medidas).
let lastResponseData = null;

const TIPOS_OFRECEN_ALTERNATIVAS = new Set(['fabricacion', 'todas_comprometidas', 'sin_stock']);
const AFFIRMATIVE_RE = /^(s[ií]|vale|okay?|dale|claro|venga|adelante|hazlo|porfa(vor)?)(\s.{0,30})?$/;

function isAffirmative(text) {
  const t = text.trim().toLowerCase().replace(/[.!?,;:]+$/g, '');
  return AFFIRMATIVE_RE.test(t);
}

function respondToAlternativasOffer(prev) {
  const alts = prev.alternativas;
  const consulta = prev.consulta || {};
  const refRaw = consulta.ref || '';
  const ref = findCanonicalRef(refRaw) || refRaw;

  if (!alts || !alts.found || alts.sin_alternativas) {
    iaBubble.innerHTML = marked.parseInline(t('msg.alts_followup.no_alternatives', {ref: ref}));
    altsSection.classList.add('hidden');
    return;
  }
  const todas = [...(alts.tier_1 || []), ...(alts.tier_2 || [])];
  const conStock = todas.filter(e => e.tiene_stock).length;
  const total = todas.length;
  if (total === 0) {
    iaBubble.innerHTML = marked.parseInline(t('msg.alts_followup.no_alternatives', {ref: ref}));
    altsSection.classList.add('hidden');
    return;
  }
  let key;
  if (conStock === 0) {
    key = total === 1 ? 'msg.alts_followup.exists_no_stock_one' : 'msg.alts_followup.exists_no_stock_other';
  } else if (total === 1) {
    key = 'msg.alts_followup.with_stock_one_one';
  } else if (conStock === 1) {
    key = 'msg.alts_followup.with_stock_other_one';
  } else {
    key = 'msg.alts_followup.with_stock_other_other';
  }
  iaBubble.innerHTML = marked.parseInline(t(key, {ref: ref, total: total, con_stock: conStock}));
  renderAlternativas(alts);
}

function updateSearchContext(data) {
  let ref = null, ancho, largo, refCount = null;

  if (data.parsed && data.parsed.coleccion_ambigua) {
    ref = data.parsed.coleccion_ambigua + ' (elige color)';
    ancho = data.parsed.ancho;
    largo = data.parsed.largo;
  } else if (data.consulta) {
    ({ ancho, largo } = data.consulta);
    const filas = data.filas || [];
    const uniqueRefs = new Set(filas.map(f => f.descripcion).filter(Boolean));

    if (uniqueRefs.size > 1) {
      // La query del usuario matchea varias referencias distintas
      // (ej. "coconut white" -> Terra Atacama, Terra Gobi, Terra Uyuni).
      // Mostrar la query en title case + conteo, NO la primera fila.
      const userQuery = (data.consulta.ref || '').trim();
      if (userQuery) {
        ref = titleCase(userQuery);
        refCount = uniqueRefs.size;
      }
    } else {
      // Una sola referencia distinta (o ninguna): canonicalizar.
      const filaDesc = filas[0] && filas[0].descripcion;
      ref = findCanonicalRef(filaDesc) || findCanonicalRef(data.consulta.ref);
      if (ref) lastRef = ref;
    }
  }

  if (!ref) {
    searchContext.style.display = 'none';
    return;
  }
  const summary = formatSearchSummary(ref, ancho, largo, refCount);
  searchContextText.textContent = summary;
  searchContext.style.display = 'block';
}
const tablaEmpty = document.getElementById('tabla-empty');
const tablaWrapper = document.getElementById('tabla-wrapper');
const tablaBody = document.getElementById('tabla-body');
const tablaFooter = document.getElementById('tabla-footer');
const tablaConteo = document.getElementById('tabla-conteo');
const altsSection = document.getElementById('alts-section');
const altsContent = document.getElementById('alts-content');
const errorBox = document.getElementById('error-box');

// Pills de forma — alternan medidas (rectangular = ancho+largo, circular = diametro)
const medRect = document.getElementById('medidas-rectangular');
const medCirc = document.getElementById('medidas-circular');
document.querySelectorAll('.pill[data-forma]').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.pill[data-forma]').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    const esCirc = p.dataset.forma === 'circular';
    medRect.classList.toggle('hidden', esCirc);
    medCirc.classList.toggle('hidden', !esCirc);
  });
});

// Catalogo para dropdown + set de referencias validas
let validRefs = new Set();
const validRefsByLower = new Map();
let refGroups = [];

function findCanonicalRef(text) {
  if (!text) return null;
  if (validRefs.has(text)) return text;
  return validRefsByLower.get(text.toLowerCase()) || null;
}

// ---------- Dropdown custom de referencias ----------
const refInput = document.getElementById('ref');
const refDropdown = document.getElementById('ref-dropdown');
const refDropdownList = document.getElementById('ref-dropdown-list');
const refResultCount = document.getElementById('ref-result-count');
let refActiveIndex = -1;

function titleCase(s) {
  // Title case preservando abreviaturas (NX, OSC) y numeros.
  // Si la entrada esta en minusculas, fuerza mayusculas en abreviaturas cortas.
  return s.split(' ').map(w => {
    if (!w) return w;
    if (/^\d/.test(w)) return w;  // numeros tal cual: "01", "850"
    if (w.length <= 2) return w.toUpperCase();  // siglas
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function highlightMatch(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const re = new RegExp(escRegex(query), 'gi');
  return safe.replace(re, m => `<mark>${m}</mark>`);
}

function renderRefDropdown(query) {
  const q = (query || '').trim().toLowerCase();
  const filtered = [];
  let total = 0;
  for (const grupo of refGroups) {
    const matches = grupo.colores.filter(c =>
      !q
      || c.ref.toLowerCase().includes(q)
      || grupo.coleccion.toLowerCase().includes(q)
    );
    if (matches.length) {
      filtered.push({coleccion: grupo.coleccion, matches});
      total += matches.length;
    }
  }
  refResultCount.textContent =
    total === 0 ? t('ui.dropdown.result_count.zero') :
    tCount('ui.dropdown.result_count', total);
  if (total === 0) {
    refDropdownList.innerHTML = `<div class="ref-empty">${escapeHtml(t('ui.dropdown.empty'))}</div>`;
    return;
  }
  let html = '';
  let optionIdx = 0;
  for (const g of filtered) {
    html += '<div class="ref-group">';
    html += `<div class="ref-group-header">${escapeHtml(titleCase(g.coleccion))}</div>`;
    for (const c of g.matches) {
      html += `<div class="ref-option" data-ref="${escapeHtml(c.ref)}" data-idx="${optionIdx}">
        <div class="ref-option-label">${highlightMatch(titleCase(c.label), q)}</div>
        <div class="ref-option-full">${highlightMatch(titleCase(c.ref), q)}</div>
      </div>`;
      optionIdx++;
    }
    html += '</div>';
  }
  refDropdownList.innerHTML = html;
  refActiveIndex = -1;
}

function openRefDropdown() {
  refDropdown.classList.remove('hidden');
  renderRefDropdown(refInput.value);
}
function closeRefDropdown() {
  refDropdown.classList.add('hidden');
  refActiveIndex = -1;
}
function setRefActive(idx) {
  const opts = refDropdownList.querySelectorAll('.ref-option');
  opts.forEach(o => o.classList.remove('active'));
  if (idx < 0 || idx >= opts.length) { refActiveIndex = -1; return; }
  refActiveIndex = idx;
  const target = opts[idx];
  target.classList.add('active');
  target.scrollIntoView({block: 'nearest'});
}

refInput.addEventListener('focus', openRefDropdown);
refInput.addEventListener('input', () => renderRefDropdown(refInput.value));
refInput.addEventListener('keydown', (e) => {
  const opts = refDropdownList.querySelectorAll('.ref-option');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (refDropdown.classList.contains('hidden')) { openRefDropdown(); return; }
    setRefActive(Math.min(refActiveIndex + 1, opts.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setRefActive(Math.max(refActiveIndex - 1, 0));
  } else if (e.key === 'Enter') {
    if (!refDropdown.classList.contains('hidden') && refActiveIndex >= 0) {
      e.preventDefault();
      refInput.value = opts[refActiveIndex].dataset.ref;
      closeRefDropdown();
    }
  } else if (e.key === 'Escape') {
    closeRefDropdown();
  }
});
refDropdownList.addEventListener('mousedown', (e) => {
  // mousedown (no click) para que dispare antes del blur del input
  const opt = e.target.closest('.ref-option');
  if (opt) {
    e.preventDefault();
    refInput.value = opt.dataset.ref;
    closeRefDropdown();
  }
});
document.addEventListener('mousedown', (e) => {
  if (!refInput.contains(e.target) && !refDropdown.contains(e.target)) {
    closeRefDropdown();
  }
});

fetch('/api/refs-grouped').then(r => r.json()).then(data => {
  refGroups = data;
  const allRefs = data.flatMap(g => g.colores.map(c => c.ref));
  validRefs = new Set(allRefs);
  allRefs.forEach(r => validRefsByLower.set(r.toLowerCase(), r));
});

const STATUS_BADGES = {
  'Correcto': 'badge-correcto',
  'Saldo': 'badge-saldo',
  'Aprestado': 'badge-aprestado',
  'Ver Anotaciones': 'badge-anotaciones',
  'Agotado': 'badge-agotado',
  'Lanzada': 'badge-lanzada',
  'Planif. en firme': 'badge-planif',
};

function fmtNum(n, dec) {
  return Number(n).toFixed(dec).replace('.', ',');
}

function fmtFecha(iso) {
  // 'YYYY-MM-DD' → 'DD/MM/YYYY'. Si no matchea el formato, devuelve tal cual.
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function displayEstado(estado) {
  const key = `ui.estados.${estado}`;
  const v = t(key);
  return (v && v !== key) ? v : (estado || '').toUpperCase();
}

function renderRows(filas) {
  if (!filas || filas.length === 0) {
    tablaEmpty.textContent = t('ui.results.empty_no_match');
    tablaEmpty.classList.remove('hidden');
    tablaWrapper.classList.add('hidden');
    tablaFooter.classList.add('hidden');
    return;
  }
  tablaEmpty.classList.add('hidden');
  tablaWrapper.classList.remove('hidden');
  tablaFooter.classList.remove('hidden');
  tablaConteo.textContent = tCount('ui.results.showing', filas.length);

  // Mostrar/ocultar la columna "Fecha fin fabricacion" segun haya piezas en fabricacion
  const hayFab = filas.some(f => f.tipo === 'fabricacion');
  const tabla = tablaWrapper.querySelector('table');
  if (tabla) tabla.classList.toggle('no-fab', !hayFab);

  tablaBody.innerHTML = filas.map((f, i) => {
    const cls = STATUS_BADGES[f.estado] || 'badge-correcto';
    const estadoTxt = displayEstado(f.estado).toUpperCase();
    const ancho = f.ancho === Math.trunc(f.ancho) ? `${f.ancho}` : fmtNum(f.ancho, 1);
    const libre = fmtNum(f.longitud_no_comprometida, 2);
    const rowCls = i === 0 ? 'row-highlight' : '';

    // Cualquier pieza con anotaciones (no solo las de estado "Ver Anotaciones")
    // muestra el toggle ▾ para desplegar el detalle.
    const tieneObs = !!(f.obs_revision || f.obs_venta);
    const badgeClass = `badge-status ${cls}${tieneObs ? ' obs-toggle' : ''}`;
    const badgeAttrs = tieneObs ? ` data-toggle-obs="${i}" title="${escapeHtml(t('ui.results.obs_tooltip'))}"` : '';
    const hint = tieneObs ? ' <span style="font-size:0.7em;opacity:0.65;">▾</span>' : '';

    let fechaTxt = '';
    if (f.tipo === 'fabricacion') {
      const fechaRaw = f.fecha_retraso || f.fecha_disponibilidad;
      fechaTxt = fechaRaw ? fmtFecha(fechaRaw) : `<span class="text-stone-400 italic">${escapeHtml(t('ui.results.fab_date_unspecified'))}</span>`;
    }

    let html = `
      <tr class="${rowCls}">
        <td><div class="flex items-center gap-2">${i === 0 ? '<span class="w-1.5 h-1.5 rounded-full bg-stone-700 inline-block"></span>' : '<span class="w-1.5 h-1.5 inline-block"></span>'}<span class="font-medium">${f.descripcion}</span></div></td>
        <td class="text-stone-600">${f.lote}</td>
        <td>${ancho}</td>
        <td>${libre}</td>
        <td><span class="${badgeClass}"${badgeAttrs}><span class="dot"></span>${estadoTxt}${hint}</span></td>
        <td class="text-stone-600 col-fab">${fechaTxt}</td>
      </tr>`;

    if (tieneObs) {
      const partes = [];
      if (f.obs_revision) partes.push(`<div><strong>${escapeHtml(t('ui.results.obs_revision'))}</strong> ${escapeHtml(f.obs_revision)}</div>`);
      if (f.obs_venta) partes.push(`<div><strong>${escapeHtml(t('ui.results.obs_venta'))}</strong> ${escapeHtml(f.obs_venta)}</div>`);
      html += `<tr class="obs-row hidden" data-obs-row="${i}"><td colspan="6"><div class="obs-content">${partes.join('')}</div></td></tr>`;
    }

    return html;
  }).join('');
}

tablaBody.addEventListener('click', (e) => {
  const badge = e.target.closest('[data-toggle-obs]');
  if (!badge) return;
  const idx = badge.dataset.toggleObs;
  const obsRow = tablaBody.querySelector(`tr[data-obs-row="${idx}"]`);
  if (obsRow) obsRow.classList.toggle('hidden');
});

function renderAltEntry(e) {
  const piezas = e.piezas || [];
  const tieneStock = e.tiene_stock;
  const headerCls = tieneStock ? 'text-emerald-800' : 'text-stone-500';
  const indicador = tieneStock
    ? `<span class="text-xs text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">${escapeHtml(tCount('ui.alternatives.in_stock', piezas.length))}</span>`
    : `<span class="text-xs text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">${escapeHtml(t('ui.alternatives.no_stock_for_size'))}</span>`;
  let tablaHTML = '';
  if (tieneStock) {
    tablaHTML = `
      <div class="mt-2 ml-1 overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="text-stone-500">
              <th class="text-left py-1 pr-3 font-medium">${escapeHtml(t('ui.alternatives.col_lote'))}</th>
              <th class="text-left py-1 pr-3 font-medium">${escapeHtml(t('ui.alternatives.col_ancho'))}</th>
              <th class="text-left py-1 pr-3 font-medium">${escapeHtml(t('ui.alternatives.col_libre'))}</th>
              <th class="text-left py-1 font-medium">${escapeHtml(t('ui.alternatives.col_estado'))}</th>
            </tr>
          </thead>
          <tbody>
            ${piezas.map((p, i) => {
              const cls = STATUS_BADGES[p.estado] || 'badge-correcto';
              const ancho = p.ancho === Math.trunc(p.ancho) ? `${p.ancho} m` : `${fmtNum(p.ancho,1)} m`;
              const libre = `${fmtNum(p.longitud_no_comprometida, 2)} m`;
              return `
                <tr class="${i === 0 ? 'font-medium' : ''}">
                  <td class="py-1 pr-3 text-stone-700">${p.lote}</td>
                  <td class="py-1 pr-3">${ancho}</td>
                  <td class="py-1 pr-3">${libre}</td>
                  <td class="py-1"><span class="badge-status ${cls}"><span class="dot"></span>${displayEstado(p.estado).toUpperCase()}</span></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }
  return `
    <div class="${tieneStock ? '' : 'opacity-70'}">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="font-semibold ${headerCls}">${e.ref}</span>
        ${indicador}
        ${e.nota ? `<span class="text-xs text-stone-500">— ${e.nota}</span>` : ''}
      </div>
      ${tablaHTML}
    </div>`;
}

function renderAlternativas(alts) {
  if (!alts || !alts.found || alts.sin_alternativas) {
    altsSection.classList.add('hidden');
    return;
  }
  let html = '';
  if (alts.tier_1 && alts.tier_1.length) {
    html += `<div><div class="font-medium text-stone-900 mb-2 text-sm uppercase tracking-wider">${escapeHtml(t('ui.alternatives.tier1_header'))}</div><div class="space-y-3">`;
    alts.tier_1.forEach(e => { html += renderAltEntry(e); });
    html += '</div></div>';
  }
  if (alts.tier_2 && alts.tier_2.length) {
    html += `<div class="mt-4"><div class="font-medium text-stone-900 mb-2 text-sm uppercase tracking-wider">${escapeHtml(t('ui.alternatives.tier2_header'))}</div><div class="space-y-3">`;
    alts.tier_2.forEach(e => { html += renderAltEntry(e); });
    html += '</div></div>';
  }
  altsContent.innerHTML = html;
  altsSection.classList.remove('hidden');
}

function setLoading(btnId, on) {
  document.getElementById(btnId + '-text').style.opacity = on ? '0.7' : '1';
  document.getElementById(btnId + '-spinner').classList.toggle('hidden', !on);
}

async function lanzarConsulta(payload, endpoint, btnId) {
  errorBox.classList.add('hidden');
  setLoading(btnId, true);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, payload, {lang: CURRENT_LANG})),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en la consulta');

    // Mensaje del IA
    iaBubble.innerHTML = marked.parseInline(data.mensaje);

    // Pildora de busqueda activa
    updateSearchContext(data);

    // Recordar respuesta para poder responder a "si" tras oferta de alternativas
    lastResponseData = data;

    // Chips de color: para preguntas ambiguas (necesita_color) y para
    // meta-preguntas tipo "qué colores hay de teide nx" (lista_colores).
    if ((data.tipo === 'necesita_color' || data.tipo === 'lista_colores') && data.chips_color) {
      const chipsHTML = data.chips_color.map(c =>
        `<button type="button" class="chip-color px-3 py-1.5 rounded-full bg-stone-100 hover:bg-amber-100 border border-stone-200 hover:border-amber-300 text-sm transition" data-ref="${c.ref}">${c.label}</button>`
      ).join('');
      iaBubble.innerHTML += `<div class="mt-3 flex flex-wrap gap-2">${chipsHTML}</div>`;
      iaBubble.querySelectorAll('.chip-color').forEach(btn => {
        btn.addEventListener('click', () => {
          const ref = btn.dataset.ref;
          const ancho = data.consulta_original?.ancho;
          const largo = data.consulta_original?.largo;
          // Lanzamos consulta directa con la ref completa
          lanzarConsulta({ ref: ref, ancho: ancho, largo: largo, unidad: 'm' }, '/api/consulta', 'btn-nl');
        });
      });
    }

    // Medida invalida: pintar chip(s) con la medida factible mas cercana
    if (data.tipo === 'medida_invalida' && data.chips_medida && data.chips_medida.length) {
      const refSugerencia = findCanonicalRef(data.consulta && data.consulta.ref) || (data.consulta && data.consulta.ref);
      const chipsHTML = data.chips_medida.map((c, idx) =>
        `<button type="button" class="chip-medida px-3 py-1.5 rounded-full bg-amber-100 hover:bg-amber-200 border border-amber-300 text-sm transition" data-idx="${idx}">${c.label}</button>`
      ).join('');
      iaBubble.innerHTML += `<div class="mt-3 flex flex-wrap gap-2">${chipsHTML}</div>`;
      iaBubble.querySelectorAll('.chip-medida').forEach(btn => {
        btn.addEventListener('click', () => {
          const c = data.chips_medida[parseInt(btn.dataset.idx, 10)];
          lanzarConsulta({ ref: refSugerencia, ancho: c.ancho, largo: c.largo, unidad: 'm' }, '/api/consulta', 'btn-nl');
        });
      });
    }

    // Tabla
    renderRows(data.filas || []);

    // Alternativas
    renderAlternativas(data.alternativas);

  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.classList.remove('hidden');
  } finally {
    setLoading(btnId, false);
  }
}

formGuiada.addEventListener('submit', e => {
  e.preventDefault();
  hideUserMessage();
  const forma = document.querySelector('.pill[data-forma].active')?.dataset.forma || 'rectangular';
  let ancho, largo;
  if (forma === 'circular') {
    const d = document.getElementById('diametro').value || null;
    // Para una alfombra circular, el rollo debe tener al menos el diametro
    // de ancho y se corta una pieza de al menos el diametro de largo.
    ancho = d;
    largo = d;
  } else {
    ancho = document.getElementById('ancho').value || null;
    largo = document.getElementById('largo').value || null;
  }
  lanzarConsulta({
    ref: document.getElementById('ref').value,
    ancho, largo, unidad: 'cm',
  }, '/api/consulta', 'btn-guiada');
  // Vaciar el form para empezar limpio en la siguiente consulta
  formGuiada.reset();
  closeRefDropdown();
});

formNL.addEventListener('submit', e => {
  e.preventDefault();
  const inputEl = document.getElementById('nl-query');
  const q = inputEl.value.trim();
  if (!q) return;
  showUserMessage(q);
  inputEl.value = '';

  // "si" tras oferta de alternativas → responder localmente con la info
  // que ya tenemos, sin tocar el backend (asi no perdemos las medidas).
  if (lastResponseData
      && TIPOS_OFRECEN_ALTERNATIVAS.has(lastResponseData.tipo)
      && isAffirmative(q)) {
    respondToAlternativasOffer(lastResponseData);
    lastResponseData = null;  // ya consumido
    return;
  }

  lanzarConsulta({ query: q, last_ref: lastRef }, '/api/consulta-nl', 'btn-nl');
});

// ============================================================
// i18n init: cargar traducciones, aplicarlas, conectar selector
// ============================================================
(async () => {
  await Promise.all([loadTranslations(CURRENT_LANG), loadTranslations('es')]);
  applyStaticTranslations();
  highlightActiveLangBtn();
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newLang = btn.dataset.lang;
      if (!newLang || newLang === CURRENT_LANG) return;
      localStorage.setItem('app-lang', newLang);
      location.reload();
    });
  });
})();
