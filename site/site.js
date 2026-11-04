// Share the page, label it for the visitor's device, reveal sections as they arrive. No network calls.
(() => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const url = location.origin + '/#get';
  const buttons = [document.getElementById('send2')].filter(Boolean);
  const shareUrl = 'mailto:?subject=EqDownload&body=' + encodeURIComponent('EqDownload: ' + url);
  for (const b of buttons) {
    b.href = shareUrl;
    if (navigator.share) {
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await navigator.share({ title: 'EqDownload', text: 'EqDownload download page', url }); }
        catch (err) { if (err && err.name !== 'AbortError') location.href = shareUrl; }
      });
    }
  }

  // The finder: ask /api/probe for the file list, then show plain links the browser downloads itself.
  const form = document.getElementById('finder');
  const out = document.getElementById('result');
  const safe = (u) => typeof u === 'string' && /^(https?:\/\/|\/api\/dl\?)/.test(u);
  const say = (text) => { out.textContent = ''; const p = document.createElement('p'); p.textContent = text; out.append(p); };
  // Chrome and Edge on a PC can ask where to save the file, so it can go to any folder or drive.
  const saveAs = async (ev, a, title, ext) => {
    ev.preventDefault();
    if (a.getAttribute('aria-busy')) return;
    const name = (String(title || 'video').replace(/[\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 80) || 'video') + '.' + (ext || 'mp4');
    let handle;
    try { handle = await window.showSaveFilePicker({ suggestedName: name }); }
    catch (err) { if (err && err.name === 'AbortError') return; location.href = a.href; return; }
    const label = a.dataset.label || (a.dataset.label = a.textContent);
    a.setAttribute('aria-busy', 'true'); a.textContent = 'Saving...';
    let w;
    try {
      const res = await fetch(a.href);
      if (!res.ok || !res.body) throw new Error('bad');
      const total = Number(res.headers.get('Content-Length')) || 0;
      w = await handle.createWritable();
      const r = res.body.getReader();
      let got = 0;
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        await w.write(value);
        got += value.length;
        if (total) a.textContent = 'Saving ' + Math.round((got / total) * 100) + '%';
      }
      if (total && got !== total) throw new Error('short');
      await w.close();
      a.textContent = 'Saved';
    } catch {
      if (w) { try { await w.abort(); } catch { /* already closed */ } }
      a.textContent = 'Failed, try again';
    } finally {
      a.removeAttribute('aria-busy');
      setTimeout(() => { a.textContent = label; }, 4000);
    }
  };

  // iPhone: Safari saves downloads to Files. The share sheet's Save Video puts the file in Photos.
  // The file is fetched on the first tap and shared on the second, because iOS only allows sharing straight after a tap.
  const canPhotos = ios && typeof navigator.canShare === 'function' && typeof File === 'function';
  const toPhotos = (btn, f, title) => {
    let file = null;
    btn.addEventListener('click', async () => {
      if (btn.getAttribute('aria-busy')) return;
      if (!file) {
        btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Getting the video...';
        try {
          const res = await fetch(f.dl);
          if (!res.ok) throw new Error('bad');
          const blob = await res.blob();
          const name = (String(title || 'video').replace(/[\/:*?"<>|\x00-\x1f]/g, '').trim().slice(0, 60) || 'video') + '.' + f.ext;
          file = new File([blob], name, { type: blob.type || 'video/mp4' });
          if (!navigator.canShare({ files: [file] })) throw new Error('unsupported');
          btn.textContent = 'Tap again: Save Video';
        } catch {
          file = null; btn.textContent = 'Could not prepare. Use the link above.';
        } finally { btn.removeAttribute('aria-busy'); }
        return;
      }
      try { await navigator.share({ files: [file] }); btn.textContent = 'Shared. Pick Save Video'; }
      catch (err) { if (!err || err.name !== 'AbortError') btn.textContent = 'Sharing failed. Use the link above.'; }
    });
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = form.elements.url.value.trim();
    if (!link) return;
    out.textContent = '';
    const lp = document.createElement('p'); lp.textContent = 'Looking...';
    const bar = document.createElement('div'); bar.className = 'loader'; bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-label', 'Reading the link');
    bar.append(document.createElement('span'), document.createElement('span'));
    out.append(lp, bar);
    const go = form.querySelector('button');
    go.disabled = true;
    try {
      const res = await fetch('/api/probe?url=' + encodeURIComponent(link));
      let data;
      try { data = await res.json(); } catch { say(res.ok ? 'Could not read that link.' : 'The server took too long or failed. Try again.'); return; }
      if (!res.ok) {
        say(data.error || 'Could not read that link.');
        if (data.blocked) {
          const a = document.createElement('a'); a.className = 'button'; a.href = '#get'; a.textContent = 'Get the app';
          out.append(a);
        }
        return;
      }
      out.textContent = '';
      if (safe(data.thumbnail)) {
        const img = document.createElement('img');
        img.src = data.thumbnail; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.loading = 'lazy';
        out.append(img);
      }
      const t = document.createElement('p'); t.className = 'r-title'; t.textContent = data.title; out.append(t);
      const list = document.createElement('div'); list.className = 'r-links';
      for (const f of data.formats) {
        if (!safe(f.url)) continue;
        const a = document.createElement('a');
        a.className = 'button'; a.href = f.url; a.setAttribute('download', '');
        if (!f.url.startsWith('/')) { a.rel = 'noopener noreferrer'; a.target = '_blank'; }
        a.textContent = f.label + (f.size ? ', ' + f.size : '');
        if (f.url.startsWith('/') && window.showSaveFilePicker) a.addEventListener('click', (ev) => saveAs(ev, a, data.title, f.ext));
        list.append(a);
        if (canPhotos && f.kind === 'video' && /^(mp4|m4v|mov)$/.test(f.ext || '') && f.dl) {
          const b = document.createElement('button'); b.type = 'button'; b.className = 'button photos'; b.textContent = 'Save to Photos, ' + f.label;
          toPhotos(b, f, data.title); list.append(b);
        }
      }
      if (list.querySelector('.photos')) {
        list.classList.add('has-photos');
        list.prepend(...list.querySelectorAll('.photos'));
        const hint = document.createElement('p'); hint.className = 'r-hint';
        hint.textContent = 'To get the video into your Photos app: tap Save to Photos, wait for the file, tap again, then choose Save Video. The smaller links below save to the Files app instead.';
        out.append(hint);
      }
      out.append(list);
      if (ios) { const n = document.createElement('p'); n.className = 'note'; n.textContent = 'On iPhone, tap Save to Photos, wait for the file, tap again and choose Save Video. The plain link saves to the Files app instead.'; out.append(n); }
    } catch {
      say('No connection. Try again.');
    } finally {
      go.disabled = false;
    }
  });
  // Paste button: reads the clipboard into the field. Browsers ask permission the first time; if they refuse, the field is focused.
  const pasteBtn = document.getElementById('paste');
  if (pasteBtn && navigator.clipboard && navigator.clipboard.readText) {
    pasteBtn.hidden = false;
    pasteBtn.addEventListener('click', async () => {
      const field = form.elements.url;
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (text) { field.value = text; }
      } catch { /* permission refused: leave the field for a manual paste */ }
      field.focus();
    });
  }
  const preset = new URLSearchParams(location.search).get('url');
  if (preset) { form.elements.url.value = preset; form.requestSubmit(); }

  // Web app: register the service worker and offer the browser's install prompt where it exists.
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  const installBtn = document.getElementById('install');
  const installHint = document.getElementById('install-hint');
  if (ios && installHint) installHint.textContent = 'Tap Share, then Add to Home Screen';
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (installBtn) installBtn.hidden = false;
    if (installHint) installHint.hidden = true;
  });
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    installBtn.hidden = true;
    if (installHint) { installHint.hidden = false; installHint.textContent = 'Installed, or open it from your apps'; }
  });
  window.addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; if (installHint) { installHint.hidden = false; installHint.textContent = 'Installed'; } });

  const items = document.querySelectorAll('[data-reveal]');
  items.forEach((el, i) => el.style.setProperty('--i', String(i % 4)));
  if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
})();
