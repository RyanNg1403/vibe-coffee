// Atmospheric distance lives in a small, static texture. Near buildings and
// park trees are real geometry; this backdrop supplies haze and the far skyline
// without adding another render pass or an animated full-screen sky shader.
export function paintSkyBackdrop(g, w, h, kind) {
  const night = kind === 'rainNight' || kind === 'garden_night';
  const dusk = kind === 'sunset' || kind === 'garden_dusk';
  const garden = kind.startsWith('garden');
  const morning = kind === 'morning' || kind === 'garden';
  let seed = 1403;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const sky = g.createLinearGradient(0, 0, 0, h);
  const palette = night ? ['#101a2b', '#253044', '#3c4550']
    : dusk ? ['#718195', '#c3b3a6', '#efd1aa']
      : morning ? ['#92b1c6', '#ccdae0', '#ede3cb'] : ['#90adbf', '#c9d8de', '#e8e6dc'];
  sky.addColorStop(0, palette[0]);
  sky.addColorStop(0.58, palette[1]);
  sky.addColorStop(1, palette[2]);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  if (!night) {
    const sx = w * (dusk ? 0.69 : 0.23), sy = h * (dusk ? 0.50 : 0.24);
    const halo = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.35);
    halo.addColorStop(0, 'rgba(255,238,208,0.45)');
    halo.addColorStop(0.15, 'rgba(255,225,181,0.16)');
    halo.addColorStop(1, 'rgba(255,225,181,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3da';
    g.beginPath(); g.arc(sx, sy, h * 0.012, 0, Math.PI * 2); g.fill();
  }

  // Soft, elongated cloud filaments. Individual puffs never have hard edges.
  g.save();
  for (let band = 0; band < 7; band++) {
    const cy = h * (0.08 + random() * 0.45);
    const cx = random() * w;
    const extent = w * (0.11 + random() * 0.18);
    g.save();
    g.translate(cx, cy);
    g.scale(extent, h * (0.006 + random() * 0.012));
    const cloud = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    cloud.addColorStop(0, night ? 'rgba(83,92,110,0.14)' : 'rgba(244,238,228,0.35)');
    cloud.addColorStop(1, 'rgba(240,233,220,0)');
    g.fillStyle = cloud;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  }
  g.restore();

  const horizon = h * 0.82;
  // Three layers of atmospheric perspective, rather than black cut-out shapes.
  for (let layer = 0; layer < 3; layer++) {
    g.fillStyle = night ? ['#293343', '#222d39', '#1a2530'][layer]
      : garden ? ['#a0afa0', '#83957e', '#677e65'][layer]
        : dusk ? ['#b2aaa1', '#99908a', '#7d7773'][layer]
          : ['#b7c3c6', '#9baeb4', '#83999f'][layer];
    if (garden) {
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w + 4; x += 4) {
        const crown = Math.sin(x * 0.047 + layer) * 7
          + Math.sin(x * 0.113 + layer * 3) * 3 + random() * 4;
        g.lineTo(x, horizon - (2 - layer) * 17 - crown);
      }
      g.lineTo(w, h); g.closePath(); g.fill();
    } else {
      for (let x = -10; x < w;) {
        const width = 12 + random() * 36;
        const height = h * (0.04 + random() * 0.13);
        const top = horizon - height + layer * 10;
        g.fillRect(x, top, width, h - top);
        // Rooftop equipment and fine windows establish scale at a distance.
        if (random() > 0.55) g.fillRect(x + width * 0.3, top - 3, width * 0.3, 3);
        const buildingColor = g.fillStyle;
        g.fillStyle = night ? 'rgba(237,199,143,0.42)' : 'rgba(219,224,222,0.2)';
        for (let wy = top + 6; wy < horizon; wy += 7) {
          for (let wx = x + 4; wx < x + width - 3; wx += 6) {
            if (random() > 0.48) g.fillRect(wx, wy, 2, 3);
          }
        }
        g.fillStyle = buildingColor;
        x += width + 2 + random() * 9;
      }
    }
  }
}
