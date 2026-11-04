// Share the page, label it for the visitor's device, reveal sections as they arrive. No network calls.
(() => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const windows = /Windows/.test(ua);
  const base = 'https://github.com/EQQX0/EqDownloader/releases/download/v0.1.2/';
  const url = location.origin + '/#get';
  const buttons = [document.getElementById('send'), document.getElementById('send2')].filter(Boolean);
  const note = document.getElementById('device');

  if (ios) {
    note.textContent = 'You are on an iPhone or iPad. Send this page to the computer or Android phone you want to use.';
  } else if (android || windows) {
    const first = buttons[0];
    first.href = base + (android ? 'EqDownload.apk' : 'EqDownload.exe');
    first.textContent = android ? 'Download for Android' : 'Download for Windows';
    note.textContent = android
      ? 'GitHub asks you to sign in first. The Android app has not been run on a phone yet.'
      : 'GitHub asks you to sign in first. Windows warns about an unknown publisher: choose More info, then Run anyway.';
    if (buttons[1]) buttons[1].href = 'mailto:?subject=EqDownload&body=' + encodeURIComponent('EqDownload: ' + url);
  }

  if (navigator.share && (ios || !(android || windows))) {
    for (const b of buttons) {
      b.addEventListener('click', async (e) => {
        e.preventDefault();
        try { await navigator.share({ title: 'EqDownload', text: 'EqDownload download page', url }); }
        catch (err) { if (err && err.name !== 'AbortError') location.href = b.href; }
      });
    }
  } else {
    for (const b of buttons) {
      if (b.getAttribute('href').startsWith('mailto:')) b.href = 'mailto:?subject=EqDownload&body=' + encodeURIComponent('EqDownload: ' + url);
    }
  }

  const items = document.querySelectorAll('[data-reveal]');
  items.forEach((el, i) => el.style.setProperty('--i', String(i % 4)));
  if (!('IntersectionObserver' in window)) { items.forEach((el) => el.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
})();
