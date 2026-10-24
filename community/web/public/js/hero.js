/** Bioluminescent mycelium. Pauses offscreen and when reduced-motion is set. */

export function startHero(canvas) {
  if (!canvas) return () => {};
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d", { alpha: true });
  let raf = 0;
  let running = true;
  let t0 = performance.now();

  const nodes = Array.from({ length: 46 }, (_, i) => {
    const ring = 0.18 + (i % 7) * 0.1;
    const a = (i / 46) * Math.PI * 2 + (i % 3) * 0.4;
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
      if (Math.hypot(dx, dy) < 0.2) hyphae.push([i, j, Math.random()]);
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawStatic() {
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    paint(width, height, 0, false);
  }

  function paint(width, height, now, animate) {
    const glow = ctx.createRadialGradient(width * 0.28, height * 0.35, 20, width * 0.4, height * 0.5, width * 0.7);
    glow.addColorStop(0, "rgba(125,255,179,0.16)");
    glow.addColorStop(0.45, "rgba(94,228,255,0.05)");
    glow.addColorStop(1, "rgba(7,17,14,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (const [i, j, bend] of hyphae) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.24) continue;
      const pulse = animate ? 0.55 + 0.45 * Math.sin(now / 900 + a.pulse) : 0.7;
      const alpha = (0.24 - dist) * 2.4 * pulse;
      ctx.strokeStyle = a.gold || b.gold ? `rgba(201,164,92,${alpha})` : `rgba(125,255,179,${alpha})`;
      ctx.lineWidth = dist < 0.1 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(a.x * width, a.y * height);
      const mx = ((a.x + b.x) / 2 + (bend - 0.5) * 0.08) * width;
      const my = ((a.y + b.y) / 2 + (0.5 - bend) * 0.07) * height;
      ctx.quadraticCurveTo(mx, my, b.x * width, b.y * height);
      ctx.stroke();
    }

    for (const node of nodes) {
      const beat = animate ? 0.65 + 0.35 * Math.sin(now / 700 + node.pulse) : 0.85;
      const r = (node.gold ? 2.6 : 1.8) * beat;
      ctx.shadowColor = node.gold ? "rgba(201,164,92,0.9)" : "rgba(125,255,179,0.85)";
      ctx.shadowBlur = 12 * beat;
      ctx.fillStyle = node.gold ? `rgba(246,193,91,${0.75 + beat * 0.2})` : `rgba(125,255,179,${0.7 + beat * 0.25})`;
      ctx.beginPath();
      ctx.arc(node.x * width, node.y * height, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
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

  const io = new IntersectionObserver((entries) => {
    running = entries.some((entry) => entry.isIntersecting);
    if (running && !reduced) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  });
  io.observe(canvas);
  resize();
  window.addEventListener("resize", resize);
  if (reduced) {
    drawStatic();
    return () => {
      io.disconnect();
      window.removeEventListener("resize", resize);
    };
  }
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    io.disconnect();
    window.removeEventListener("resize", resize);
  };
}
