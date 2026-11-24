/* Hesapla — GeoGebra'nın resmi gömülebilir motoru üzerine kişisel bir kabuk. */
(() => {
  'use strict';

  const GGB_SCRIPT = 'https://www.geogebra.org/apps/deployggb.js';
  const KEY = {
    settings: 'hesapla.settings',
    files: 'hesapla.files',
    autosave: (app) => 'hesapla.autosave.' + app,
  };

  const FILL = 'fill="var(--accent-soft)"';
  const APPS = [
    { id: 'graphing', label: 'Grafik', short: 'Grafik', suite: 'graphing',
      icon: `<svg viewBox="0 0 80 80"><path d="M20 66c2-18 4-40 10-40s10 30 18 32 10-14 12-36"/><circle cx="30" cy="22" r="5.5" ${FILL}/><circle cx="48" cy="56" r="5.5" ${FILL}/></svg>` },
    { id: 'geometry', label: 'Geometri', short: 'Geometri', suite: 'geometry',
      icon: `<svg viewBox="0 0 80 80"><circle cx="30" cy="50" r="15" ${FILL}/><path d="M46 16L66 50H26z" ${FILL} fill-opacity=".85"/></svg>` },
    { id: '3d', label: '3B Hesap Makinesi', short: '3B', suite: '3d',
      icon: `<svg viewBox="0 0 80 80"><path d="M40 12L14 58l26 10 26-10z" ${FILL}/><path d="M40 12v56M40 12L14 58" /><path d="M40 12L14 58l26 10z" fill="var(--accent)"/></svg>` },
    { id: 'cas', label: 'CAS', short: 'CAS', suite: 'cas',
      icon: `<svg viewBox="0 0 80 80"><rect x="14" y="14" width="52" height="52" rx="4" fill="var(--surface)"/><rect x="14" y="14" width="10" height="52" rx="2" ${FILL} stroke="none"/><text x="31" y="49" font-size="24" font-weight="700" fill="var(--icon-stroke)" stroke="none" font-family="Arial, sans-serif">x=</text></svg>` },
    { id: 'probability', label: 'Olasılık', short: 'Olasılık', suite: 'probability',
      icon: `<svg viewBox="0 0 80 80"><path d="M31 64V30c3-9 6-14 9-14s6 5 9 14v34z" ${FILL} stroke="none"/><path d="M10 64c8 0 12-12 18-30s8-18 12-18 6 0 12 18 10 30 18 30"/><path d="M10 64h60"/></svg>` },
    { id: 'scientific', label: 'Bilimsel', short: 'Bilimsel', appName: 'scientific',
      icon: `<svg viewBox="0 0 80 80"><rect x="16" y="12" width="48" height="56" rx="5"/><path d="M16 28h48M16 44h48"/><rect x="16" y="46" width="48" height="22" rx="3" ${FILL} stroke="none"/><path d="M26 20h8M30 16v8M26 36h8M27 55h8M27 60h8"/></svg>` },
  ];
  const byId = (id) => APPS.find((a) => a.id === id);

  // ---------- Depolama (try/catch ile güvenli) ----------
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (_) { return false; }
    },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* yok say */ } },
  };

  const settings = Object.assign(
    { language: 'tr', theme: 'light', autosave: true, reopenLast: true, lastApp: null },
    store.get(KEY.settings, {})
  );
  const saveSettings = () => store.set(KEY.settings, settings);

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const launcher = $('launcher'), calc = $('calc'), holder = $('ggb-holder'), statusEl = $('ggb-status');
  const drawer = $('drawer'), drawerBackdrop = $('drawer-backdrop');
  const modal = $('modal'), modalBackdrop = $('modal-backdrop');

  function applyTheme() {
    document.documentElement.dataset.theme = settings.theme;
    document.querySelector('meta[name="theme-color"]').content = settings.theme === 'dark' ? '#1b1b1f' : '#f3f3f6';
  }
  applyTheme();

  // ---------- Açılış ekranı ----------
  $('app-grid').innerHTML = APPS.map((a) => `
    <button class="app-tile" data-app="${a.id}">
      <span class="circle">${a.icon}</span>
      <span class="label">${a.label}</span>
    </button>`).join('');
  $('app-grid').addEventListener('click', (e) => {
    const t = e.target.closest('[data-app]');
    if (t) openApp(t.dataset.app);
  });
  $('launcher-close').addEventListener('click', () => {
    if (current.app) showCalc();
  });

  function showLauncher() {
    closeDrawer();
    $('launcher-close').classList.toggle('hidden', !current.app);
    launcher.classList.remove('hidden');
    calc.classList.add('hidden');
  }
  function showCalc() {
    launcher.classList.add('hidden');
    calc.classList.remove('hidden');
    resizeApplet();
  }

  // ---------- GeoGebra yükleme ----------
  let ggbScriptPromise = null;
  function loadGgbScript() {
    if (window.GGBApplet) return Promise.resolve();
    if (ggbScriptPromise) return ggbScriptPromise;
    ggbScriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GGB_SCRIPT;
      s.async = true;
      s.onload = () => (window.GGBApplet ? resolve() : reject(new Error('GGBApplet yok')));
      s.onerror = () => { ggbScriptPromise = null; s.remove(); reject(new Error('Betik yüklenemedi')); };
      document.head.appendChild(s);
    });
    return ggbScriptPromise;
  }

  const current = { app: null, api: null, dirty: false, fileId: null, fileName: null, mountSeq: 0 };

  async function openApp(appId, base64, fileMeta) {
    const app = byId(appId) || APPS[0];
    if (current.app && current.api) autosaveNow();
    current.app = app.id;
    current.api = null;
    current.dirty = false;
    current.fileId = fileMeta ? fileMeta.id : null;
    current.fileName = fileMeta ? fileMeta.name : null;
    settings.lastApp = app.id; saveSettings();

    $('rail-title').textContent = current.fileName ? `${app.short} · ${current.fileName}` : app.short;
    $('rail-tools').classList.toggle('hidden', app.id === 'scientific');
    showCalc();

    const seq = ++current.mountSeq;
    const old = holder.querySelector('.ggb-mount');
    if (old) old.remove();
    statusEl.textContent = 'Yükleniyor…';
    statusEl.classList.remove('hidden');

    try {
      await loadGgbScript();
    } catch (_) {
      if (seq !== current.mountSeq) return;
      statusEl.innerHTML = 'Hesap makinesi motoru yüklenemedi.<br>İnternet bağlantını kontrol edip tekrar dene.<br><br><button class="btn-primary" id="retry-btn">Tekrar dene</button>';
      $('retry-btn').onclick = () => openApp(app.id, base64, fileMeta);
      return;
    }
    if (seq !== current.mountSeq) return;

    const restore = base64 != null ? base64 : (settings.autosave ? store.get(KEY.autosave(app.id), null) : null);
    const mount = document.createElement('div');
    mount.className = 'ggb-mount';
    mount.id = 'ggb-mount-' + seq;
    mount.style.cssText = 'position:absolute;inset:0;';
    holder.insertBefore(mount, statusEl);

    const params = {
      id: 'ggbApplet' + seq,
      appName: app.appName || 'suite',
      width: holder.clientWidth,
      height: holder.clientHeight,
      language: settings.language,
      showToolBar: true,
      showAlgebraInput: true,
      showMenuBar: false,
      showResetIcon: false,
      enableLabelDrags: true,
      enableShiftDragZoom: true,
      enableRightClick: true,
      showZoomButtons: true,
      enableUndoRedo: true,
      showFullscreenButton: false,
      useBrowserForJS: false,
      preventFocus: false,
      borderColor: settings.theme === 'dark' ? '#26262b' : '#FFFFFF',
      appletOnLoad: (api) => onAppletLoad(api, app, seq),
    };
    if (restore) params.ggbBase64 = restore;

    try {
      const applet = new window.GGBApplet(params, true);
      applet.inject(mount.id);
    } catch (err) {
      statusEl.textContent = 'Hesap makinesi başlatılamadı: ' + err.message;
    }
  }

  function onAppletLoad(api, app, seq) {
    if (seq !== current.mountSeq) return;
    current.api = api;
    statusEl.classList.add('hidden');
    // Suite içinde doğru alt uygulamaya geç (CAS, Olasılık, 3B…)
    if (app.suite && typeof api.switchCalculator === 'function') {
      try { api.switchCalculator(app.suite); } catch (_) { /* eski sürüm */ }
    }
    const markDirty = () => { current.dirty = true; };
    const names = ['registerAddListener', 'registerRemoveListener', 'registerUpdateListener', 'registerRenameListener'];
    names.forEach((n) => { try { api[n](markDirty); } catch (_) { /* yok say */ } });
    resizeApplet();
  }

  function resizeApplet() {
    if (!current.api || calc.classList.contains('hidden')) return;
    try { current.api.setSize(holder.clientWidth, holder.clientHeight); } catch (_) { /* yok say */ }
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resizeApplet, 120); });

  // ---------- Otomatik kayıt ----------
  function autosaveNow() {
    if (!settings.autosave || !current.api || !current.app || !current.dirty) return;
    try {
      const b64 = current.api.getBase64();
      if (b64) store.set(KEY.autosave(current.app), b64);
      current.dirty = false;
    } catch (_) { /* yok say */ }
  }
  setInterval(autosaveNow, 5000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosaveNow(); });
  window.addEventListener('pagehide', autosaveNow);

  // ---------- Yan menü ----------
  function openDrawer() {
    $('drawer-head').textContent = 'Hesapla · ' + (byId(current.app) || APPS[0]).label;
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    drawerBackdrop.classList.remove('hidden');
  }
  function closeDrawer() {
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
    drawerBackdrop.classList.add('hidden');
  }
  $('menu-btn').addEventListener('click', openDrawer);
  drawerBackdrop.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', (e) => {
    const item = e.target.closest('[data-action]');
    if (!item) return;
    closeDrawer();
    ACTIONS[item.dataset.action]();
  });
  $('rail-save').addEventListener('click', () => ACTIONS.save());
  $('rail-tools').addEventListener('click', () => ACTIONS.commands());
  $('rail-undo').addEventListener('click', () => { try { current.api && current.api.undo(); } catch (_) { /* yok say */ } });

  // ---------- Diyalog ----------
  function showModal(title, bodyHtml, actions) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = bodyHtml;
    const box = $('modal-actions');
    box.innerHTML = '';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = a.primary ? 'btn-primary' : 'btn-text';
      b.textContent = a.label;
      b.onclick = () => { if (a.onClick && a.onClick() === false) return; hideModal(); };
      box.appendChild(b);
    });
    modal.classList.remove('hidden'); modalBackdrop.classList.remove('hidden');
  }
  function hideModal() { modal.classList.add('hidden'); modalBackdrop.classList.add('hidden'); }
  modalBackdrop.addEventListener('click', hideModal);

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const needApi = () => { if (!current.api) { toast('Hesap makinesi henüz yüklenmedi'); return false; } return true; };

  // ---------- Dosyalar ----------
  const getFiles = () => store.get(KEY.files, []);
  const fmtDate = (ts) => new Date(ts).toLocaleString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  function saveAs(name) {
    let b64;
    try { b64 = current.api.getBase64(); } catch (_) { toast('Kaydedilemedi'); return; }
    const files = getFiles();
    let f = current.fileId && files.find((x) => x.id === current.fileId && x.name === name);
    if (f) { f.b64 = b64; f.date = Date.now(); f.app = current.app; }
    else {
      f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, app: current.app, date: Date.now(), b64 };
      files.unshift(f);
    }
    if (!store.set(KEY.files, files)) { toast('Depolama alanı dolu — eski dosyaları sil'); return; }
    current.fileId = f.id; current.fileName = f.name;
    $('rail-title').textContent = `${byId(current.app).short} · ${f.name}`;
    toast(`"${name}" kaydedildi`);
  }

  function renderOpenList() {
    const files = getFiles();
    if (!files.length) return '<div class="empty">Henüz kayıtlı dosya yok.</div>';
    return '<div class="list">' + files.map((f) => `
      <div class="list-row">
        <button class="main" data-open="${f.id}"><b>${esc(f.name)}</b><small>${esc((byId(f.app) || {}).label || f.app)} · ${fmtDate(f.date)}</small></button>
        <button class="btn-danger" data-del="${f.id}">Sil</button>
      </div>`).join('') + '</div>';
  }

  // ---------- Komut yardımcısı ----------
  const COMMANDS = [
    { k: 'plot', t: 'Grafiğini çiz', d: 'f(x) olarak ekler', make: (e) => `f(x)=${e}` },
    { k: 'der', t: 'Türev', d: "f'(x)", make: (e) => `Derivative(${e})` },
    { k: 'der2', t: 'İkinci türev', d: "f''(x)", make: (e) => `Derivative(${e},2)` },
    { k: 'int', t: 'Belirsiz integral', d: '∫ f(x) dx', make: (e) => `Integral(${e})` },
    { k: 'dint', t: 'Belirli integral', d: 'a ile b arası alan', ab: true, make: (e, a, b) => `Integral(${e},${a},${b})` },
    { k: 'root', t: 'Kökler', d: 'f(x)=0 noktaları', make: (e) => `Root(${e})` },
    { k: 'ext', t: 'Ekstremum', d: 'Yerel max / min', make: (e) => `Extremum(${e})` },
    { k: 'infl', t: 'Dönüm noktası', d: 'Büküm noktaları', make: (e) => `InflectionPoint(${e})` },
    { k: 'tan', t: 'Teğet', d: 'x = a noktasında', a: true, make: (e, a) => `Tangent(${a},${e})` },
    { k: 'lim', t: 'Limit', d: 'x → a', a: true, make: (e, a) => `Limit(${e},${a})` },
    { k: 'solve', t: 'Denklem çöz', d: 'ör. x^2-4=0', make: (e) => `Solve(${e})` },
    { k: 'factor', t: 'Çarpanlara ayır', d: 'Factor', make: (e) => `Factor(${e})` },
    { k: 'expand', t: 'Aç (genişlet)', d: 'Expand', make: (e) => `Expand(${e})` },
    { k: 'simp', t: 'Sadeleştir', d: 'Simplify', make: (e) => `Simplify(${e})` },
  ];

  function runCommand(cmd) {
    const expr = $('cmd-expr').value.trim();
    const a = $('cmd-a').value.trim() || '0';
    const b = $('cmd-b').value.trim() || '1';
    if (!expr) { toast('Önce bir ifade yaz'); return false; }
    if (!needApi()) return false;
    settings.lastExpr = expr; saveSettings();
    let ok = false;
    try { ok = current.api.evalCommand(cmd.make(expr, a, b)); } catch (_) { ok = false; }
    if (ok) { current.dirty = true; toast(cmd.t + ' eklendi'); return true; }
    toast('Komut çalıştırılamadı — ifadeyi kontrol et');
    return false;
  }

  // ---------- Menü eylemleri ----------
  const ACTIONS = {
    clear() {
      if (!needApi()) return;
      showModal('Tümünü temizle', '<p>Bu çalışmadaki her şey silinecek. Emin misin?</p>', [
        { label: 'Vazgeç' },
        { label: 'Temizle', primary: true, onClick: () => {
          try { current.api.newConstruction(); } catch (_) { current.api.reset(); }
          store.del(KEY.autosave(current.app));
          current.fileId = null; current.fileName = null; current.dirty = false;
          $('rail-title').textContent = byId(current.app).short;
        } },
      ]);
    },

    open() {
      showModal('Aç', renderOpenList(), [{ label: 'Kapat' }]);
      $('modal-body').onclick = (e) => {
        const o = e.target.closest('[data-open]');
        const d = e.target.closest('[data-del]');
        if (o) {
          const f = getFiles().find((x) => x.id === o.dataset.open);
          hideModal();
          if (f) openApp(f.app, f.b64, f);
        } else if (d) {
          store.set(KEY.files, getFiles().filter((x) => x.id !== d.dataset.del));
          if (current.fileId === d.dataset.del) current.fileId = null;
          $('modal-body').innerHTML = renderOpenList();
        }
      };
    },

    save() {
      if (!needApi()) return;
      const def = current.fileName || `${byId(current.app).label} ${new Date().toLocaleDateString('tr-TR')}`;
      showModal('Kaydet', `<label class="label-sm">Dosya adı</label><input class="field" id="save-name" value="${esc(def)}" maxlength="60">`, [
        { label: 'Vazgeç' },
        { label: 'Kaydet', primary: true, onClick: () => {
          const n = $('save-name').value.trim();
          if (!n) { toast('Bir ad yaz'); return false; }
          saveAs(n);
        } },
      ]);
      setTimeout(() => { const f = $('save-name'); f && f.select(); }, 50);
    },

    async export() {
      if (!needApi()) return;
      let b64;
      try { b64 = current.api.getPNGBase64(2, true, 144); } catch (_) { b64 = null; }
      if (!b64) { toast('Bu hesap makinesinde resim dışa aktarılamıyor'); return; }
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const name = (current.fileName || 'hesapla') + '.png';
      const file = new File([arr], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Resim kaydedildi');
    },

    async share() {
      if (!needApi()) return;
      let b64;
      try { b64 = current.api.getBase64(); } catch (_) { toast('Paylaşılamadı'); return; }
      const bin = atob(b64); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      const name = (current.fileName || 'hesapla') + '.ggb';
      const file = new File([arr], name, { type: 'application/vnd.geogebra.file' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; }
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },

    switch() { autosaveNow(); showLauncher(); },

    commands() {
      if (!needApi()) return;
      const last = settings.lastExpr || '';
      showModal('Komutlar', `
        <label class="label-sm">İfade / fonksiyon</label>
        <input class="field" id="cmd-expr" placeholder="ör. x^3 - 3x + 1" value="${esc(last)}" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div style="display:flex;gap:10px">
          <div style="flex:1"><label class="label-sm">a</label><input class="field" id="cmd-a" placeholder="0" inputmode="decimal"></div>
          <div style="flex:1"><label class="label-sm">b</label><input class="field" id="cmd-b" placeholder="1" inputmode="decimal"></div>
        </div>
        <div class="cmd-grid">${COMMANDS.map((c) => `<button class="cmd-btn" data-cmd="${c.k}"><b>${c.t}</b><small>${c.d}${c.a ? ' (a)' : ''}${c.ab ? ' (a, b)' : ''}</small></button>`).join('')}</div>
      `, [{ label: 'Kapat' }]);
      $('modal-body').onclick = (e) => {
        const btn = e.target.closest('[data-cmd]');
        if (!btn) return;
        const cmd = COMMANDS.find((c) => c.k === btn.dataset.cmd);
        if (runCommand(cmd)) hideModal();
      };
    },

    settings() {
      showModal('Ayarlar', `
        <p class="label-sm">Dil (hesap makinesi içi)</p>
        <label class="radio-row"><input type="radio" name="lang" value="tr" ${settings.language === 'tr' ? 'checked' : ''}>Türkçe</label>
        <label class="radio-row"><input type="radio" name="lang" value="en" ${settings.language === 'en' ? 'checked' : ''}>English</label>
        <p class="label-sm" style="margin-top:12px">Görünüm</p>
        <label class="radio-row"><input type="radio" name="theme" value="light" ${settings.theme === 'light' ? 'checked' : ''}>Açık</label>
        <label class="radio-row"><input type="radio" name="theme" value="dark" ${settings.theme === 'dark' ? 'checked' : ''}>Koyu (menüler)</label>
        <p class="label-sm" style="margin-top:12px">Diğer</p>
        <label class="radio-row"><input type="checkbox" id="set-autosave" ${settings.autosave ? 'checked' : ''}>Çalışmayı otomatik kaydet</label>
        <label class="radio-row"><input type="checkbox" id="set-reopen" ${settings.reopenLast ? 'checked' : ''}>Açılışta son hesap makinesini aç</label>
      `, [
        { label: 'Vazgeç' },
        { label: 'Kaydet', primary: true, onClick: () => {
          const lang = document.querySelector('input[name="lang"]:checked').value;
          const theme = document.querySelector('input[name="theme"]:checked').value;
          const langChanged = lang !== settings.language;
          settings.language = lang; settings.theme = theme;
          settings.autosave = $('set-autosave').checked;
          settings.reopenLast = $('set-reopen').checked;
          saveSettings(); applyTheme();
          if (langChanged && current.app) {
            autosaveNow();
            let b64 = null;
            try { b64 = current.api && current.api.getBase64(); } catch (_) { /* yok say */ }
            openApp(current.app, b64, current.fileId ? { id: current.fileId, name: current.fileName } : null);
          }
        } },
      ]);
    },

    help() {
      showModal('Yardım', `
        <p><b>Grafik:</b> Sol paneldeki giriş satırına <code>x^2-3</code> gibi bir ifade yaz, grafik hemen çizilir.</p>
        <p><b>Komutlar:</b> Soldaki “Komutlar” düğmesi türev, integral, kök, ekstremum, limit ve denklem çözme gibi işlemleri tek dokunuşla ekler.</p>
        <p><b>Kaydet / Aç:</b> Çalışmalar bu cihazda saklanır. Otomatik kayıt açıksa kaldığın yerden devam edersin.</p>
        <p><b>Resim:</b> Menü → Resim Olarak Dışa Aktar ile grafiği Fotoğraflar'a kaydedebilirsin.</p>
        <p class="label-sm">Hesaplama motoru: GeoGebra (geogebra.org), kişisel ve ticari olmayan kullanım.</p>
      `, [{ label: 'Tamam', primary: true }]);
    },
  };

  // ---------- Başlangıç ----------
  if (settings.reopenLast && settings.lastApp && byId(settings.lastApp)) openApp(settings.lastApp);
  else showLauncher();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* yok say */ });
  }
})();
