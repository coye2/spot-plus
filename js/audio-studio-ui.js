// audio-studio-ui.js — Renders the tabbed Audio, Parametric EQ, AutoEq & DSP Studio sheet.
// All adjustments apply in real time without restarting or interrupting playback.

import * as dsp from './dsp.js';
import * as autoeq from './autoeq.js';
import * as fx from './fx.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtFreq(hz) {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${Math.round(hz)}`;
}

function fmtDb(v) {
  const n = Number(v) || 0;
  return `${n > 0 ? '+' : ''}${n.toFixed(1)} dB`;
}

export function renderEQCurveSVG(state) {
  const autoProfile = state.autoEqEnabled && state.autoEqId ? autoeq.findProfile(state.autoEqId) : null;
  const activeEq = state.enabled && state.eqEnabled ? state.bands : [];
  const activeAuto = state.enabled && autoProfile ? autoProfile.bands : [];
  const pts = dsp.computeEQCurve(activeEq, activeAuto, 56);
  const w = 320, h = 92, padY = 10;
  const toY = (db) => padY + ((12 - Math.max(-12, Math.min(12, db))) / 24) * (h - padY * 2);
  const path = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = toY(p.db);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const fillPath = `${path} L${w},${toY(0).toFixed(1)} L0,${toY(0).toFixed(1)} Z`;

  return `<div class="eq-curve-box">
    <svg class="eq-curve-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="${toY(6).toFixed(1)}" x2="${w}" y2="${toY(6).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3 3"/>
      <line x1="0" y1="${toY(0).toFixed(1)}" x2="${w}" y2="${toY(0).toFixed(1)}" stroke="rgba(255,255,255,0.22)"/>
      <line x1="0" y1="${toY(-6).toFixed(1)}" x2="${w}" y2="${toY(-6).toFixed(1)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3 3"/>
      <path d="${fillPath}" fill="var(--accent)" fill-opacity="0.22"/>
      <path d="${path}" fill="none" stroke="var(--accent-text, var(--accent))" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </div>`;
}

export function renderAudioStudio({ tab = 'eq', selectedBand = 0, autoEqQuery = '', autoEqForm = '', fxBodyHtml = '' } = {}) {
  const s = dsp.getDSP();
  const activeTab = ['eq', 'headphones', 'dsp', 'fx'].includes(tab) ? tab : 'eq';
  const activeProfile = s.autoEqId ? autoeq.findProfile(s.autoEqId) : null;
  const userPresets = dsp.loadUserEQPresets();

  const tabsHtml = `<div class="dsp-tabs" role="tablist" aria-label="Audio studio sections">
    ${[['eq', 'Equalizer'], ['headphones', 'Headphones'], ['dsp', 'DSP'], ['fx', 'Effects']].map(([id, label]) =>
      `<button type="button" class="dsp-tab${activeTab === id ? ' on' : ''}" role="tab" aria-selected="${activeTab === id}" data-act="dsp-tab" data-tab="${id}">${label}</button>`
    ).join('')}
  </div>`;

  let panelHtml = '';

  if (activeTab === 'eq') {
    const bandIdx = Math.max(0, Math.min(s.bands.length - 1, Number(selectedBand) || 0));
    const sel = s.bands[bandIdx];
    const presetChips = [
      ...Object.entries(dsp.EQ_PRESETS).map(([id, p]) => `<button type="button" class="chip${s.eqEnabled && s.eqPreset === id ? ' on' : ''}" data-act="eq-preset" data-preset="${id}">${esc(p.label)}</button>`),
      ...userPresets.map((p) => `<button type="button" class="chip${s.eqEnabled && s.eqPreset === p.id ? ' on' : ''}" data-act="eq-preset" data-preset="${esc(p.id)}">${esc(p.name)}</button>`),
    ].join('');

    panelHtml = `
      <div class="dsp-master-row">
        <div><b>Parametric Equalizer</b><small>${s.enabled && s.eqEnabled ? 'Active · real-time 10-band filter bank' : 'Bypassed · zero audio alteration'}</small></div>
        <input type="checkbox" role="switch" data-dsp-toggle="eqEnabled" ${s.enabled && s.eqEnabled ? 'checked' : ''} aria-label="Enable Parametric Equalizer">
      </div>
      ${renderEQCurveSVG(s)}
      <div class="fx-presets">${presetChips}</div>
      <div class="eq-sliders">
        ${s.bands.map((b, i) => `
          <div class="eq-band${i === bandIdx ? ' selected' : ''}" data-act="eq-select-band" data-band="${i}">
            <span class="eq-band-gain" id="eqGain-${i}">${b.gain > 0 ? '+' : ''}${b.gain.toFixed(1)}</span>
            <input type="range" min="-12" max="12" step="0.5" value="${b.gain}" data-eq-gain="${i}" aria-label="${fmtFreq(b.freq)} Hz gain">
            <span class="eq-band-freq">${fmtFreq(b.freq)}</span>
          </div>`).join('')}
      </div>
      <div class="eq-band-editor">
        <label>Filter type
          <select data-eq-prop="type" data-band="${bandIdx}">
            <option value="lowshelf"${sel.type === 'lowshelf' ? ' selected' : ''}>Low Shelf</option>
            <option value="peaking"${sel.type === 'peaking' ? ' selected' : ''}>Peaking</option>
            <option value="highshelf"${sel.type === 'highshelf' ? ' selected' : ''}>High Shelf</option>
          </select>
        </label>
        <label>Freq (Hz)
          <input type="number" min="20" max="20000" step="10" value="${Math.round(sel.freq)}" data-eq-prop="freq" data-band="${bandIdx}">
        </label>
        <label>Q factor
          <input type="number" min="0.25" max="10" step="0.1" value="${sel.q.toFixed(2)}" data-eq-prop="q" data-band="${bandIdx}">
        </label>
      </div>
      <div class="row-btns">
        <button type="button" class="btn small" data-act="eq-save-preset">Save preset</button>
        <button type="button" class="btn small" data-act="eq-reset">Reset flat</button>
      </div>`;
  } else if (activeTab === 'headphones') {
    const matches = autoeq.searchProfiles(autoEqQuery, { form: autoEqForm, limit: 40 });
    const forms = ['', 'Over-ear', 'TWS', 'IEM', 'On-ear', 'Earbud'];
    panelHtml = `
      <div class="dsp-master-row">
        <div>
          <b>Headphone Correction (AutoEq)</b>
          <small>${s.enabled && s.autoEqEnabled && activeProfile ? `${esc(activeProfile.name)} · Preamp ${activeProfile.preamp.toFixed(1)} dB` : 'Match your headphones to a neutral Harman curve'}</small>
        </div>
        <input type="checkbox" role="switch" data-dsp-toggle="autoEqEnabled" ${s.enabled && s.autoEqEnabled && !!activeProfile ? 'checked' : ''} aria-label="Enable AutoEq headphone correction">
      </div>
      ${renderEQCurveSVG(s)}
      <div class="autoeq-search-row">
        <input type="search" id="autoEqSearch" value="${esc(autoEqQuery)}" placeholder="Search AirPods, Sony XM5, HD600, Moondrop…" autocomplete="off" aria-label="Search headphone models">
        ${s.autoEqId ? '<button type="button" class="btn small" data-act="autoeq-clear">Off</button>' : ''}
      </div>
      <div class="fx-row">
        ${forms.map((f) => `<button type="button" class="chip${autoEqForm === f ? ' on' : ''}" data-act="autoeq-form" data-form="${esc(f)}">${f || 'All'}</button>`).join('')}
      </div>
      <div class="autoeq-list">
        ${matches.length ? matches.map((p) => {
          const on = s.enabled && s.autoEqEnabled && s.autoEqId === p.id;
          return `<button type="button" class="autoeq-item${on ? ' on' : ''}" data-act="autoeq-pick" data-id="${esc(p.id)}">
            <div><b>${esc(p.name)}</b><small>${p.bands.length} parametric bands · Preamp ${p.preamp.toFixed(1)} dB</small></div>
            <span class="autoeq-tag">${on ? 'Active' : esc(p.form)}</span>
          </button>`;
        }).join('') : '<p class="muted pad center">No matching headphones found. Try another model or import an AutoEq ParametricEQ.txt file.</p>'}
      </div>
      <div class="row-btns" style="margin-top:10px">
        <button type="button" class="btn small" data-act="autoeq-import">Import AutoEq text</button>
      </div>
      <p class="settings-note">${esc(autoeq.AUTOEQ_ATTRIBUTION)}</p>`;
  } else if (activeTab === 'dsp') {
    const slider = (key, label, min, max, step, fmt) =>
      `<label class="fx-slider"><span>${label}<b id="dspv-${key}">${fmt(s[key])}</b></span><input type="range" data-dsp-range="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}" aria-label="${label}"></label>`;
    panelHtml = `
      <div class="dsp-master-row">
        <div><b>Audio DSP Engine</b><small>${dsp.isDSPActive(s) ? 'Processing active in real time' : 'Master bypass · bit-transparent audio'}</small></div>
        <input type="checkbox" role="switch" data-dsp-toggle="enabled" ${s.enabled ? 'checked' : ''} aria-label="Enable Audio DSP Engine">
      </div>
      <div class="dsp-card">
        <div class="dsp-card-head"><div><b>Output & Loudness</b><small>Preamp gain, loudness leveling & true-peak safety limiter</small></div></div>
        ${slider('preampDb', 'Master Preamp', -12, 6, 0.5, fmtDb)}
        <label class="field"><span>Loudness normalization<small>Evens out quiet and loud tracks smoothly.</small></span><input type="checkbox" role="switch" data-dsp-toggle="loudnessNorm" ${s.loudnessNorm ? 'checked' : ''}></label>
        <label class="field"><span>True-peak safety limiter<small>Prevents distortion when EQ or bass boost is high.</small></span><input type="checkbox" role="switch" data-dsp-toggle="limiterEnabled" ${s.limiterEnabled ? 'checked' : ''}></label>
      </div>
      <div class="dsp-card">
        <div class="dsp-card-head"><div><b>Dynamics Compressor</b><small>Tightens dynamic range for noisy environments or late-night listening</small></div><input type="checkbox" role="switch" data-dsp-toggle="compressorEnabled" ${s.compressorEnabled ? 'checked' : ''} aria-label="Enable Dynamics Compressor"></div>
        ${slider('compressorThreshold', 'Threshold', -40, -4, 1, (v) => `${Math.round(v)} dB`)}
        ${slider('compressorRatio', 'Ratio', 1.5, 16, 0.5, (v) => `${Number(v).toFixed(1)}:1`)}
      </div>
      <div class="dsp-card">
        <div class="dsp-card-head"><div><b>Spatial & Tone</b><small>Stereo width, headphone crossfeed, sub-bass & channel balance</small></div></div>
        ${slider('bassEnhanceDb', 'Sub-Bass Warmth', 0, 10, 0.5, fmtDb)}
        ${slider('stereoWidth', 'Stereo Width', 0, 180, 5, (v) => v === 0 ? 'Mono' : v === 100 ? 'Natural (100%)' : `${Math.round(v)}%`)}
        <label class="field"><span>Headphone Crossfeed<small>Blends subtle L/R cues for natural speaker staging.</small></span><input type="checkbox" role="switch" data-dsp-toggle="crossfeedEnabled" ${s.crossfeedEnabled ? 'checked' : ''}></label>
        ${s.crossfeedEnabled ? slider('crossfeedLevel', 'Crossfeed Amount', 0, 100, 5, (v) => `${Math.round(v)}%`) : ''}
        ${slider('balance', 'Channel Balance', -1, 1, 0.05, (v) => Math.abs(v) < 0.03 ? 'Center' : v < 0 ? `${Math.round(-v * 100)}% L` : `${Math.round(v * 100)}% R`)}
      </div>
      <div class="row-btns">
        <button type="button" class="btn small" data-act="dsp-reset">Reset all DSP</button>
      </div>`;
  } else {
    panelHtml = fxBodyHtml;
  }

  const blockedNote = fx.isBlocked()
    ? '<p class="settings-note fx-note">This track’s audio server restricts cross-origin audio analysis, so EQ/DSP is temporarily bypassed and resumes automatically on the next compatible track.</p>'
    : '<p class="settings-note fx-note">All EQ, AutoEq, and DSP settings run locally in Web Audio with zero extra server requests and adjust live without restarting your song.</p>';

  return `<div class="dsp-studio" data-dsp-active-tab="${activeTab}">${tabsHtml}${panelHtml}${blockedNote}</div>`;
}
