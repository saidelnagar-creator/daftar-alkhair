// أدوات DOM صغيرة بلا مكتبات.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k in el && k !== 'list' && k !== 'form') {
        try {
          el[k] = v;
        } catch {
          el.setAttribute(k, v);
        }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  // append المتسامحة: تتجاهل null/false وتفرد المصفوفات (append الأصلية تحوّلها نصاً)
  el.append = (...more) => append(el, more);
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// أيقونات SVG بسيطة (مسارات فقط) للشريط السفلي والأزرار.
const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM8 12a3 3 0 1 0-3-3 3 3 0 0 0 3 3zm8 2c-3 0-7 1.5-7 4v2h14v-2c0-2.5-4-4-7-4zM8 14c-2.7 0-6 1.3-6 3.5V20h5v-2c0-1.4.8-2.6 2-3.5A9 9 0 0 0 8 14z',
  family: 'M12 3l9 7h-2v10h-5v-6h-4v6H5V10H3z',
  wallet: 'M4 6h14a2 2 0 0 1 2 2v1h-5a3 3 0 0 0 0 6h5v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm11 5h6v2h-6a1 1 0 0 1 0-2z',
  more: 'M5 10a2 2 0 1 0 2 2 2 2 0 0 0-2-2zm7 0a2 2 0 1 0 2 2 2 2 0 0 0-2-2zm7 0a2 2 0 1 0 2 2 2 2 0 0 0-2-2z',
  back: 'M9 5l7 7-7 7',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z',
  close: 'M6 6l12 12M18 6L6 18',
  eye: 'M12 5C7 5 2.7 8.1 1 12c1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  eyeOff: 'M3.3 2.3L2 3.6l3.1 3.1A12.6 12.6 0 0 0 1 12c1.7 3.9 6 7 11 7 1.7 0 3.3-.3 4.8-1l3.6 3.7 1.3-1.3zM12 16.5a4.5 4.5 0 0 1-4.2-6.1l1.6 1.6a2.5 2.5 0 0 0 2.6 2.6l1.6 1.6c-.5.2-1 .3-1.6.3zM12 5c5 0 9.3 3.1 11 7a12.7 12.7 0 0 1-3.3 4.5l-3.4-3.4A4.5 4.5 0 0 0 10.9 7.7L8.6 5.5C9.7 5.2 10.8 5 12 5z',
  tune: 'M3 6h10v2H3zm14 0h4v2h-4zm-2-2h2v6h-2zM3 16h4v2H3zm8 0h10v2H11zm-2-2h2v6H9zM3 11h8v2H3zm12 0h6v2h-6z',
  search: 'M10 4a6 6 0 1 0 3.9 10.6l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4zm0 2a4 4 0 1 1-4 4 4 4 0 0 1 4-4z',
};

export function icon(name, size = 24) {
  const stroke = name === 'back' || name === 'close';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || '');
  if (stroke) {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2.2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  } else p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}
