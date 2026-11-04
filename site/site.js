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
  const safe = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
  const say = (text) => { out.textContent = ''; const p = document.createElement('p'); p.textContent = text; out.append(p); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = form.elements.url.value.trim();
    if (!link) return;
    say('Looking...');
    const go = form.querySelector('button');
    go.disabled = true;
    try {
      const res = await fetch('/api/probe?url=' + encodeURIComponent(link));
      const data = await res.json();
      if (!res.ok) { say(data.error || 'Could not read that link.'); return; }
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
        a.className = 'button'; a.href = f.url; a.rel = 'noopener noreferrer'; a.target = '_blank'; a.setAttribute('download', '');
        a.textContent = f.label + (f.size ? ', ' + f.size : '');
        list.append(a);
      }
      out.append(list);
      if (ios) { const n = document.createElement('p'); n.className = 'note'; n.textContent = 'On iPhone, the file opens in Safari. Use the Share button, then Save to Files or Save Video.'; out.append(n); }
    } catch {
      say('No connection. Try again.');
    } finally {
      go.disabled = false;
    }
  });
  const preset = new URLSearchParams(location.search).get('url');
  if (preset) { form.elements.url.value = preset; form.requestSubmit(); }

  const items = document.querySelectorAll('[data-reveal]');
  items.forEach((el, i) => el.style.setProperty('--i', String(i % 4)));
  if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
})();
