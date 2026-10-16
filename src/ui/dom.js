// Small DOM helpers shared by the interface: element building, icons, the
// toast, and short descriptions shown on hover (mouse) or long-press (touch).
export const $ = (sel) => document.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'tip') { n.dataset.tip = v[0]; if (v[1]) n.dataset.tipSub = v[1]; }
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}
export const icon = (id) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.innerHTML = `<use href="#i-${id}"/>`; s.setAttribute('aria-hidden', 'true'); return s; };

let toastTimer = 0;
export function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

// Any element with data-tip (and optionally data-tip-sub) gets a small
// description after a short hover, or after a long press on touch screens.
export function setupTips() {
  const tip = $('#tip');
  let timer = 0, target = null, hideTimer = 0;
  const show = (t) => {
    target = t;
    tip.replaceChildren(document.createTextNode(t.dataset.tip), ...(t.dataset.tipSub ? [el('small', {}, t.dataset.tipSub)] : []));
    tip.classList.add('on');
    const r = t.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    // beside a picture in the drawer, above anything else
    const inDrawer = !!t.closest('.drawer');
    let x = inDrawer ? r.right + 10 : r.left + r.width / 2 - w / 2, y = inDrawer ? r.top + 8 : r.top - h - 10;
    if (!inDrawer && y < 8) y = r.bottom + 10;
    x = Math.max(8, Math.min(innerWidth - w - 8, x)); y = Math.max(8, Math.min(innerHeight - h - 8, y));
    tip.style.transform = `translate(${x}px, ${y}px)`;
  };
  const hide = () => { clearTimeout(timer); target = null; tip.classList.remove('on'); };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest?.('[data-tip]');
    if (t === target) return;
    hide();
    if (t && !document.body.classList.contains('dragging')) timer = setTimeout(() => show(t), 420);
  });
  document.addEventListener('pointerdown', (e) => {
    hide();
    if (e.pointerType !== 'touch') return;
    const t = e.target.closest?.('[data-tip]');
    if (t) timer = setTimeout(() => { show(t); clearTimeout(hideTimer); hideTimer = setTimeout(hide, 2600); }, 520);
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, (e) => { if (e.pointerType === 'touch' && !target) clearTimeout(timer); }, true);
  document.addEventListener('scroll', hide, true);
  addEventListener('blur', hide);
  return { hide };
}
