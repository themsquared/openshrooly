/** Bioluminescent mycelium. Pauses offscreen and when reduced-motion is set. */

export function startHero(canvas) {
  if (!canvas) return () => {};
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d", { alpha: true });
  let raf = 0;
  let running = true;
  let t0 = performance.now();

  const nodes = Array.from({ length: 58 }, (_, i) => {
    const ring = 0.14 + (i % 8) * 0.09;
    const a = (i / 58) * Math.PI * 2 + (i % 3) * 0.4;
    return {
      x: 0.5 + Math.cos(a) * ring * (0.7 + Math.random() * 0.5),
      y: 0.42 + Math.sin(a) * ring * 0.55,
      vx: (Math.random() - 0.5) * 0.00022,
      vy: (Math.random() - 0.5) * 0.00018,
      pulse: Math.random() * Math.PI * 2,
      gold: i % 5 === 0,
    };
  });

  const hyphae = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (Math.hypot(dx, dy) < 0.26) hyphae.push([i, j, Math.random()]);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function copyRect(width, height) {
    const copy = canvas.parentElement?.querySelector(".hero-copy");
    if (!copy) return null;
    const canvasBox = canvas.getBoundingClientRect();
    const box = copy.getBoundingClientRect();
    return {
      x: box.left - canvasBox.left,
      y: box.top - canvasBox.top,
      w: Math.min(box.width + 28, width),
      h: Math.min(box.height + 16, height),
    };
  }

  function inCopy(nx, ny, rect, width, height, pad = 28) {
    if (!rect) return false;
    const x = nx * width;
    const y = ny * height;
    return x >= rect.x - pad && x <= rect.x + rect.w + pad && y >= rect.y - pad && y <= rect.y + rect.h + pad;
  }

  function drawStatic() {
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    paint(width, height, 0, false);
  }

  function paint(width, height, now, animate) {
    const rect = copyRect(width, height);
    const glowX = width < 800 ? width * 0.55 : width * 0.78;
    const glowY = width < 800 ? height * 0.78 : height * 0.42;
    const glow = ctx.createRadialGradient(glowX, glowY, 10, glowX, glowY, width * 0.55);
    glow.addColorStop(0, "rgba(125,255,179,0.2)");
    glow.addColorStop(0.4, "rgba(94,228,255,0.06)");
    glow.addColorStop(1, "rgba(7,17,14,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (const [i, j, bend] of hyphae) {
      const a = nodes[i];
      const b = nodes[j];
      if (inCopy(a.x, a.y, rect, width, height) && inCopy(b.x, b.y, rect, width, height)) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.3) continue;
      const pulse = animate ? 0.62 + 0.38 * Math.sin(now / 820 + a.pulse) : 0.85;
      let alpha = Math.min(0.85, (0.3 - dist) * 3.4 * pulse);
      if (inCopy(a.x, a.y, rect, width, height) || inCopy(b.x, b.y, rect, width, height)) alpha *= 0.08;
      ctx.strokeStyle = a.gold || b.gold ? `rgba(246,193,91,${alpha})` : `rgba(125,255,179,${alpha})`;
      ctx.lineWidth = dist < 0.1 ? 2.1 : 1.35;
      ctx.beginPath();
      ctx.moveTo(a.x * width, a.y * height);
      const mx = ((a.x + b.x) / 2 + (bend - 0.5) * 0.08) * width;
      const my = ((a.y + b.y) / 2 + (0.5 - bend) * 0.07) * height;
      ctx.quadraticCurveTo(mx, my, b.x * width, b.y * height);
      ctx.stroke();
    }

    for (const node of nodes) {
      if (node.gold && inCopy(node.x, node.y, rect, width, height, 36)) continue;
      if (inCopy(node.x, node.y, rect, width, height, 16)) continue;
      const beat = animate ? 0.7 + 0.3 * Math.sin(now / 640 + node.pulse) : 0.95;
      const r = (node.gold ? 3.4 : 2.3) * beat;
      ctx.shadowColor = node.gold ? "rgba(246,193,91,1)" : "rgba(125,255,179,1)";
      ctx.shadowBlur = 18 * beat;
      ctx.fillStyle = node.gold ? `rgba(255,214,120,${0.85 + beat * 0.15})` : `rgba(160,255,200,${0.8 + beat * 0.2})`;
      ctx.beginPath();
      ctx.arc(node.x * width, node.y * height, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (rect) {
      const fade = width < 800
        ? ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h + 36)
        : ctx.createLinearGradient(rect.x, 0, rect.x + rect.w + 48, 0);
      if (width < 800) {
        fade.addColorStop(0, "rgba(7,17,14,0.94)");
        fade.addColorStop(0.78, "rgba(7,17,14,0.88)");
        fade.addColorStop(1, "rgba(7,17,14,0.15)");
      } else {
        fade.addColorStop(0, "rgba(7,17,14,0.95)");
        fade.addColorStop(0.7, "rgba(7,17,14,0.86)");
        fade.addColorStop(1, "rgba(7,17,14,0)");
      }
      ctx.fillStyle = fade;
      ctx.fillRect(Math.max(0, rect.x - 12), Math.max(0, rect.y - 12), rect.w + 56, rect.h + 28);
    }
  }

  function frame(now) {
    if (!running) return;
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    for (const node of nodes) {
      node.x += node.vx;
      node.y += node.vy;
      if (node.x < 0.04 || node.x > 0.98) node.vx *= -1;
      if (node.y < 0.06 || node.y > 0.94) node.vy *= -1;
    }
    paint(width, height, now - t0, true);
    raf = requestAnimationFrame(frame);
  }

  function onResize() {
    resize();
    if (reduced) drawStatic();
  }

  const io = new IntersectionObserver((entries) => {
    running = entries.some((entry) => entry.isIntersecting);
    if (running && !reduced) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  });
  io.observe(canvas);
  resize();
  window.addEventListener("resize", onResize);
  if (reduced) {
    drawStatic();
    return () => {
      io.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    io.disconnect();
    window.removeEventListener("resize", onResize);
  };
}
