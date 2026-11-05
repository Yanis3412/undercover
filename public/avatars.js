// =====================================================================
//  AVATARS - 16 personnages dessinés en SVG
//  Pour en ajouter : ajoute une ligne dans PRESETS ET augmente
//  AVATAR_COUNT dans server.js.
// =====================================================================
(() => {
  const INK = '#1a2130';

  // Accessoires : chacun renvoie { back, front } (back = derrière la tête)
  const F = {
    short: h => ({ front: `<path d="M20 27C20 14.5 44 14.5 44 27C40.5 20.5 23.5 20.5 20 27Z" fill="${h}"/>` }),
    side: h => ({ front: `<path d="M20 28C19 14 45 13 44 26C38 22 30 23 24 19C23 23 21.5 25.5 20 28Z" fill="${h}"/>` }),
    long: h => ({
      back: `<path d="M18.5 30C18 12.5 46 12.5 45.5 30L47 47H17Z" fill="${h}"/>`,
      front: `<path d="M20 26.5C21 14.5 43 14.5 44 26.5C38 20.5 26 20.5 20 26.5Z" fill="${h}"/>`,
    }),
    bun: h => ({
      back: `<circle cx="32" cy="12.5" r="6.5" fill="${h}"/>`,
      front: `<path d="M20 27C20 14.5 44 14.5 44 27C40.5 20.5 23.5 20.5 20 27Z" fill="${h}"/>`,
    }),
    curly: h => ({
      front: `<g fill="${h}"><circle cx="22" cy="23" r="5"/><circle cx="27" cy="17.5" r="5.5"/><circle cx="33.5" cy="16" r="5.5"/><circle cx="39.5" cy="18.5" r="5"/><circle cx="42.5" cy="24" r="4.5"/></g>`,
    }),
    fedora: (h, a) => ({
      front: `<path d="M22.5 19.5C22.5 8.5 41.5 8.5 41.5 19.5Z" fill="${INK}"/><rect x="22.5" y="16" width="19" height="3.5" fill="${a}"/><ellipse cx="32" cy="20" rx="17" ry="3.2" fill="${INK}"/>`,
    }),
    cap: (h, a) => ({
      front: `<path d="M20.5 23C20.5 10.5 43.5 10.5 43.5 23Z" fill="${a}"/><path d="M32 21.5H50.5C50.5 25 47 24.8 43.5 24.2L32 23.2Z" fill="${a}" opacity=".8"/>`,
    }),
    beanie: (h, a) => ({
      front: `<path d="M19.5 24C19.5 9 44.5 9 44.5 24Z" fill="${a}"/><rect x="19" y="20.5" width="26" height="5.5" rx="2.2" fill="${a}" opacity=".75"/><circle cx="32" cy="8.5" r="3.2" fill="${a}"/>`,
    }),
    sunglasses: () => ({
      front: `<rect x="22.5" y="25.8" width="8.6" height="5.4" rx="2.2" fill="${INK}"/><rect x="32.9" y="25.8" width="8.6" height="5.4" rx="2.2" fill="${INK}"/><rect x="30" y="27" width="4" height="1.4" fill="${INK}"/>`,
    }),
    glasses: () => ({
      front: `<g fill="none" stroke="${INK}" stroke-width="1.5"><circle cx="27.4" cy="28.8" r="3.9"/><circle cx="36.6" cy="28.8" r="3.9"/><path d="M31.3 28.6H32.7"/></g>`,
    }),
    mustache: h => ({
      front: `<path d="M26.5 34.6C28 31.4 31 32.4 32 33.5C33 32.4 36 31.4 37.5 34.6C35 33.6 33.2 34.4 32 34.6C30.8 34.4 29 33.6 26.5 34.6Z" fill="${h}"/>`,
    }),
    beard: h => ({
      front: `<path d="M20.2 29C20.5 45 43.5 45 43.8 29C42 35.5 38.2 37.6 32 37.6C25.8 37.6 22 35.5 20.2 29Z" fill="${h}"/>`,
    }),
    mask: () => ({
      front: `<path d="M20.5 26.2Q32 22.4 43.5 26.2L42.4 31.6Q37 33.4 32 30.4Q27 33.4 21.6 31.6Z" fill="${INK}"/><circle cx="27.5" cy="28.6" r="1.5" fill="#fff"/><circle cx="36.5" cy="28.6" r="1.5" fill="#fff"/>`,
      noEyes: true,
    }),
    headphones: (h, a) => ({
      front: `<path d="M18.5 29C18.5 11 45.5 11 45.5 29" fill="none" stroke="${INK}" stroke-width="2.6"/><rect x="15.5" y="25" width="6" height="10" rx="2.6" fill="${a}"/><rect x="42.5" y="25" width="6" height="10" rx="2.6" fill="${a}"/>`,
    }),
    tie: (h, a) => ({ front: `<path d="M30.4 43.5H33.6L34.8 52L32 56.5L29.2 52Z" fill="${a}"/>` }),
    bowtie: (h, a) => ({ front: `<path d="M25.5 43.2L31 45.8V46.4L25.5 49Z M38.5 43.2L33 45.8V46.4L38.5 49Z" fill="${a}"/><circle cx="32" cy="46.1" r="1.6" fill="${a}"/>` }),
    collar: () => ({ front: `<path d="M25.5 43L32 49L38.5 43L36 47.5L32 51L28 47.5Z" fill="#f4f1ea" opacity=".9"/>` }),
    earring: () => ({ front: `<circle cx="20.6" cy="33" r="1.4" fill="#f2c94c"/>` }),
  };

  //   bg = fond, skin = peau, hair = cheveux, shirt = haut, acc = couleur d'accessoire
  const PRESETS = [
    { bg: '#3e5c76', skin: '#f0c9a4', hair: '#2a2019', shirt: '#22303f', acc: '#c0392b', f: ['short', 'fedora', 'tie'] },
    { bg: '#6b5876', skin: '#c88b62', hair: '#1f1712', shirt: '#2d2433', acc: '#e9e6df', f: ['long', 'sunglasses', 'collar'] },
    { bg: '#4f7a68', skin: '#8d5a3b', hair: '#1c1410', shirt: '#2a3b33', acc: '#f2c94c', f: ['curly', 'glasses', 'earring'] },
    { bg: '#9a5b4f', skin: '#f3d6bd', hair: '#b8742f', shirt: '#4a2b26', acc: '#2d4a63', f: ['bun', 'mask'] },
    { bg: '#3f6f80', skin: '#e2ae86', hair: '#5a3a22', shirt: '#203a44', acc: '#e07a3f', f: ['short', 'headphones'] },
    { bg: '#7d6a45', skin: '#f0c9a4', hair: '#8a8f96', shirt: '#3b3324', acc: '#a23b2a', f: ['short', 'mustache', 'glasses', 'bowtie'] },
    { bg: '#5a4f7c', skin: '#a8714b', hair: '#1f1712', shirt: '#2b2540', acc: '#5fbf8f', f: ['short', 'beard', 'beanie'] },
    { bg: '#82545f', skin: '#f3d6bd', hair: '#a3352a', shirt: '#3c2228', acc: '#e9e6df', f: ['long', 'glasses'] },
    { bg: '#4a6b4a', skin: '#c88b62', hair: '#2a2019', shirt: '#26352a', acc: '#d9a441', f: ['side', 'cap'] },
    { bg: '#3d4f78', skin: '#8d5a3b', hair: '#1c1410', shirt: '#1f2a44', acc: '#e9e6df', f: ['bun', 'sunglasses', 'collar'] },
    { bg: '#8a6a3f', skin: '#e2ae86', hair: '#3a2a1c', shirt: '#3e301d', acc: '#2c3e57', f: ['curly', 'mustache', 'fedora'] },
    { bg: '#54707a', skin: '#f0c9a4', hair: '#d9b36c', shirt: '#2a383d', acc: '#c0392b', f: ['side', 'mask', 'tie'] },
    { bg: '#6e4e6a', skin: '#a8714b', hair: '#2a2019', shirt: '#352434', acc: '#f2c94c', f: ['long', 'headphones', 'earring'] },
    { bg: '#5f6f4a', skin: '#f3d6bd', hair: '#6b4423', shirt: '#2f3824', acc: '#b5523b', f: ['short', 'beard', 'glasses'] },
    { bg: '#7a4c43', skin: '#c88b62', hair: '#1f1712', shirt: '#3a2420', acc: '#e9e6df', f: ['side', 'sunglasses', 'bowtie'] },
    { bg: '#475a6e', skin: '#e2ae86', hair: '#8a8f96', shirt: '#25303c', acc: '#5fbf8f', f: ['curly', 'beanie', 'mustache'] },
  ];

  const cache = new Map();

  function avatarSVG(index) {
    const i = ((Number(index) % PRESETS.length) + PRESETS.length) % PRESETS.length;
    if (cache.has(i)) return cache.get(i);
    const p = PRESETS[i];
    const parts = p.f.map(name => F[name](p.hair, p.acc));
    const back = parts.map(x => x.back || '').join('');
    const front = parts.map(x => x.front || '').join('');
    const eyes = parts.some(x => x.noEyes) ? '' :
      `<circle cx="27.5" cy="28.8" r="1.6" fill="${INK}"/><circle cx="36.5" cy="28.8" r="1.6" fill="${INK}"/>`;
    const svg =
      `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<rect width="64" height="64" fill="${p.bg}"/>` +
      back +
      `<path d="M9 64C9 49 19.5 42.5 32 42.5S55 49 55 64Z" fill="${p.shirt}"/>` +
      `<rect x="28" y="36" width="8" height="8" rx="2" fill="${p.skin}"/>` +
      `<rect x="28" y="38" width="8" height="3" fill="#000" opacity=".12"/>` +
      `<ellipse cx="32" cy="28" rx="12" ry="13" fill="${p.skin}"/>` +
      eyes +
      `<path d="M29.2 35.2Q32 37.2 34.8 35.2" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>` +
      front +
      `</svg>`;
    cache.set(i, svg);
    return svg;
  }

  window.AVATAR_COUNT = PRESETS.length;
  window.avatarSVG = avatarSVG;
})();
