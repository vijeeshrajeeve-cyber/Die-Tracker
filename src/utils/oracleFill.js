// "Fill die": a browser bookmark that fills Oracle's die-creation screens
// (GEX PIM Engineer → Create Item) from a batch copied on the tracker's Oracle
// Entry page. It runs inside Oracle, so `oracleFill` must not reference anything
// outside its own body: it is turned into a javascript: link by its source text.
//
// It fills, it never clicks: Finish, Apply and Submit stay with the user. A
// field is filled only when its label is found on the page; anything else is
// listed as missed in the panel. Fixed values are Oracle conventions confirmed
// by the user on 2026-10-24 (see docs/superpowers/specs/2026-10-24-oracle-die-entry-design.md).

export function oracleFill() {
  var MARK = 'DIETRACKER-ORACLE-BATCH v1'; // = ORACLE_BATCH_MARK in oracleEntry.js
  var KEY = 'dietracker.oracleBatch';
  var PANEL_ID = 'dietracker-oracle-panel';

  // ── Batch state, kept in Oracle's own localStorage between pages ──
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: lasts this page only */ }
  }
  function askForBatch() {
    var text = window.prompt('Paste the batch copied from Die Tracker (Ctrl+V), then OK.');
    if (!text) return null;
    text = text.trim();
    if (text.indexOf(MARK) !== 0) {
      window.alert('That is not a Die Tracker batch. On the Oracle Entry page click "Copy batch for Oracle" first.');
      return null;
    }
    var dies;
    try { dies = JSON.parse(text.slice(MARK.length)); } catch { dies = null; }
    if (!dies || !dies.length) { window.alert('The batch has no dies in it.'); return null; }
    var state = { dies: dies, pointer: 0, reached: {} };
    save(state);
    return state;
  }

  // ── Finding fields by their visible label ──
  function norm(text) {
    return String(text || '').replace(/\(example:[^)]*\)/gi, '').replace(/\*/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function isControl(el) {
    var tag = el.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
    return tag === 'INPUT' && !/^(hidden|button|submit|image|checkbox|radio|reset)$/i.test(el.type);
  }
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function controlAfter(node) {
    // The first visible control after the label, in the label's own cell or the
    // cells right after it. A cell with text but no control is the next field's
    // label (or a read-only value), so the search stops there rather than borrow
    // another field's box.
    function first(scope) {
      var all = scope.querySelectorAll('input, select, textarea');
      for (var i = 0; i < all.length; i++) {
        if (isControl(all[i]) && visible(all[i]) && (node.compareDocumentPosition(all[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return all[i];
      }
      return null;
    }
    var cell = node.closest('td, th');
    if (!cell) return node.parentElement ? first(node.parentElement) : null;
    var found = first(cell);
    for (var next = cell.nextElementSibling; !found && next; next = next.nextElementSibling) {
      found = first(next);
      if (!found && norm(next.textContent)) return null;
    }
    return found;
  }
  function field(label) {
    var want = norm(label);
    var labels = document.querySelectorAll('label');
    for (var i = 0; i < labels.length; i++) {
      if (norm(labels[i].textContent) === want) {
        var byFor = labels[i].htmlFor && document.getElementById(labels[i].htmlFor);
        if (byFor && isControl(byFor)) return byFor;
        var after = controlAfter(labels[i]);
        if (after) return after;
      }
    }
    var cells = document.querySelectorAll('td, th, span, div');
    for (var j = 0; j < cells.length; j++) {
      var cell = cells[j];
      if (cell.children.length > 1 || norm(cell.textContent) !== want) continue;
      var found = controlAfter(cell);
      if (found) return found;
    }
    return null;
  }

  // ── Setting values the way a person would ──
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function setText(el, value) {
    el.focus();
    el.value = String(value);
    fire(el, 'input'); fire(el, 'change'); el.blur(); fire(el, 'blur');
    return true;
  }
  function setSelect(el, wanted) {
    var names = [].concat(wanted).filter(Boolean).map(function (w) { return String(w).trim().toLowerCase(); });
    var options = [].slice.call(el.options);
    // Exact option text or value only: a near match ("1" for 12, "Phoenix" for
    // Phoenix Middle East) would be a different press or supplier.
    var pick = null;
    names.some(function (n) {
      pick = options.find(function (o) { return o.text.trim().toLowerCase() === n || o.value.trim().toLowerCase() === n; });
      return !!pick;
    });
    if (!pick) return false;
    el.value = pick.value;
    fire(el, 'change');
    return true;
  }
  function put(report, label, value, choices) {
    if (value === null || value === undefined || value === '') { report.missed.push(label + ': not in the tracker'); return; }
    var el = field(label);
    if (!el) { report.missed.push(label + ': field not found on this page'); return; }
    var ok = el.tagName === 'SELECT' ? setSelect(el, choices || value) : setText(el, value);
    if (ok) report.filled.push(label);
    else report.missed.push(label + ': "' + value + '" is not in Oracle’s list');
  }

  // The "Dies available on presses" row: a table with Priority / Press / Remark headers.
  function fillPressRow(report, die) {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].rows;
      for (var r = 0; r < rows.length; r++) {
        var heads = [].map.call(rows[r].cells, function (c) { return norm(c.textContent); });
        var pri = heads.indexOf('priority'); var press = heads.indexOf('press'); var remark = heads.indexOf('remark');
        if (pri < 0 || press < 0 || remark < 0) continue;
        var cells = rows[r + 1] ? rows[r + 1].cells : [];
        var ctl = function (k) { return cells[k] && cells[k].querySelector('input, select, textarea'); };
        if (!ctl(press)) {
          report.missed.push('Dies available on presses: click "Add Another Row", then Fill die again');
          return;
        }
        if (ctl(pri)) { ctl(pri).tagName === 'SELECT' ? setSelect(ctl(pri), '1') : setText(ctl(pri), '1'); }
        if (!die.press) report.missed.push('Press: not in the tracker');
        else if (ctl(press).tagName === 'SELECT' ? setSelect(ctl(press), die.press) : setText(ctl(press), die.press)) report.filled.push('Press ' + die.press);
        else report.missed.push('Press: "' + die.press + '" is not in Oracle’s list');
        if (ctl(remark) && !ctl(remark).value.trim()) setText(ctl(remark), '.');
        return;
      }
    }
    report.missed.push('Dies available on presses: table not found');
  }

  // ── The three screens ──
  var pageText = document.body ? document.body.innerText : '';
  function screen() {
    if (/Update GEX/.test(pageText) && /Die Status/.test(pageText)) return 'update';
    if (/Enter Number\/Description/.test(pageText)) return 'basic';
    if (/Create Selection/.test(pageText) && /Item Catalog Category/.test(pageText)) return 'create';
    return null;
  }

  function fillCreate(report) {
    put(report, 'Item Catalog Category', 'GEX.DIE');
    put(report, 'Number Of Items', '1');
  }
  function fillBasic(report, die) {
    put(report, 'Item Description', 'Die');
    put(report, 'Profile ID', die.profileId);
    put(report, 'Number of cavities', die.cavities);
    put(report, 'Die Diameter', die.diameter);
    put(report, 'Die Index', die.dieIndex);
    put(report, 'Die Suppliers', die.supplier, die.supplierNames);
    put(report, 'Die Type', die.dieType);
    put(report, 'Die Thickness', die.thickness);
  }
  function fillUpdate(report, die) {
    put(report, 'Die Status', 'Active');
    put(report, 'Reason', 'Die available');
    put(report, 'Number of cavities', die.cavities);
    put(report, 'Die Diameter', die.diameter);
    put(report, 'Die Thickness', die.thickness);
    put(report, 'Die Suppliers', die.supplier, die.supplierNames);
    put(report, 'Die Type', die.dieType);
    put(report, 'Die Life', die.dieLife);
    put(report, 'Primary_Press', die.press);
    fillPressRow(report, die);
    put(report, 'Ordered Date', die.orderedDate);
    put(report, 'Main Corrector', 'IMRAN');
    put(report, 'Secondary Corrector', 'IMRAN');
  }

  // ── The panel ──
  function panel(state, report, note) {
    var old = document.getElementById(PANEL_ID);
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = PANEL_ID;
    box.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:340px;max-height:80vh;overflow:auto;'
      + 'background:#fff;color:#1f2937;border:2px solid #f97316;border-radius:10px;padding:12px 14px;'
      + 'font:13px/1.45 Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)';
    var die = state.dies[state.pointer];
    var html = '<div style="font-weight:700;font-size:14px;margin-bottom:4px">Fill die · Die Tracker</div>';
    if (die) {
      html += '<div>Die ' + (state.pointer + 1) + ' of ' + state.dies.length + ': <b>' + die.dieNo + '</b>'
        + (die.dieType ? ' · ' + die.dieType : '') + '</div>'
        + '<div style="color:#6b7280">Oracle item ' + die.itemCode + '</div>';
      if (die.flags && die.flags.length) html += '<div style="color:#b45309;margin-top:4px">Check: ' + die.flags.join(', ') + '</div>';
    } else {
      html += '<div><b>Batch finished.</b> All ' + state.dies.length + ' dies done.</div>';
    }
    if (note) html += '<div style="margin-top:6px">' + note + '</div>';
    if (report) {
      if (report.filled.length) html += '<div style="color:#15803d;margin-top:6px">✓ ' + report.filled.join(', ') + '</div>';
      if (report.missed.length) html += '<div style="color:#b91c1c;margin-top:6px">' + report.missed.map(function (m) { return '✗ ' + m; }).join('<br>') + '</div>';
      html += '<div style="margin-top:6px;color:#6b7280">Check the screen, then press Oracle’s own button yourself.</div>';
    }
    html += '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">'
      + ['prev:‹ Previous', 'next:Next ›', 'new:New batch', 'close:Close'].map(function (b) {
        var parts = b.split(':');
        return '<button type="button" data-act="' + parts[0] + '" style="padding:4px 10px;border:1px solid #d1d5db;border-radius:6px;background:#f9fafb;cursor:pointer">' + parts[1] + '</button>';
      }).join('') + '</div>';
    box.innerHTML = html;
    box.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'close') { box.remove(); return; }
      if (act === 'new') { var fresh = askForBatch(); if (fresh) panel(fresh, null, 'Batch loaded. Click Fill die on each Oracle screen.'); return; }
      state.pointer = Math.max(0, Math.min(state.dies.length, state.pointer + (act === 'next' ? 1 : -1)));
      save(state);
      panel(state, null, 'Click Fill die to fill this screen for the die above.');
    });
    document.body.appendChild(box);
  }

  // ── Run ──
  var state = load();
  if (!state || !state.dies || !state.dies.length) {
    state = askForBatch();
    if (!state) return;
  }
  state.reached = state.reached || {};
  var where = screen();
  if (!where) {
    panel(state, null, 'This is not a Create Item, Enter Number/Description or Update GEX screen. Open GEX PIM Engineer → Create Item.');
    return;
  }
  var report = { filled: [], missed: [] };
  var note = '';
  if (where === 'update') {
    // The page names the item, so the die comes from the page, not the pointer.
    var named = (pageText.match(/GEX\.DIE_[A-Za-z0-9]+_\d+/) || [])[0];
    var index = -1;
    for (var k = 0; k < state.dies.length; k++) if (state.dies[k].itemCode === named) index = k;
    if (index < 0) {
      panel(state, null, 'This item' + (named ? ' (' + named + ')' : '') + ' is not in the batch, so nothing was filled.');
      return;
    }
    state.pointer = index;
    state.reached[named] = true;
    fillUpdate(report, state.dies[index]);
    note = 'Update screen filled. After Apply, create the New Item Request as usual.';
  } else {
    if (where === 'create' && state.dies[state.pointer] && state.reached[state.dies[state.pointer].itemCode]) {
      state.pointer += 1; // the last die got as far as Update GEX: start the next one
    }
    var die = state.dies[state.pointer];
    if (!die) { save(state); panel(state, null, 'Click New batch to load the next day’s dies.'); return; }
    if (where === 'create') { fillCreate(report); note = 'Then click Continue.'; }
    else { fillBasic(report, die); note = 'Die Status stays Ordered here; it becomes Active on the Update screen.'; }
  }
  save(state);
  panel(state, report, note);
}

// The bookmark's href. Built from the function's own source text.
export const bookmarkletHref = () => `javascript:${encodeURIComponent(`(${oracleFill.toString()})()`)}`;
