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

  function drawStatic() {
    const { width, height } = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, width, height);
    paint(width, height, 0, false);
  }

  function paint(width, height, now, animate) {
    const glow = ctx.createRadialGradient(width * 0.3, height * 0.38, 10, width * 0.42, height * 0.48, width * 0.62);
    glow.addColorStop(0, "rgba(125,255,179,0.28)");
    glow.addColorStop(0.35, "rgba(94,228,255,0.1)");
    glow.addColorStop(1, "rgba(7,17,14,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    for (const [i, j, bend] of hyphae) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.3) continue;
      const pulse = animate ? 0.62 + 0.38 * Math.sin(now / 820 + a.pulse) : 0.85;
      const alpha = Math.min(0.85, (0.3 - dist) * 3.4 * pulse);
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
