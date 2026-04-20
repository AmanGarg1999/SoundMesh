// SoundMesh — App Shell & Mesh Background Animation

/**
 * Initialize the animated mesh network background
 * Floating nodes with glowing connection lines
 */
export function initMeshBackground() {
  const canvas = document.getElementById('mesh-bg');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let width, height;
  let nodes = [];
  let animationId;

  const NODE_COUNT = 30;
  const CONNECTION_DIST = 200;
  const NODE_SPEED = 0.3;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function createNodes() {
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * NODE_SPEED,
        vy: (Math.random() - 0.5) * NODE_SPEED,
        radius: 2 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.4,
      });
    }
  }

  function drawFrame() {
    ctx.clearRect(0, 0, width, height);

    // Update & draw connections
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];

      // Update position
      a.x += a.vx;
      a.y += a.vy;

      // Bounce off edges
      if (a.x < 0 || a.x > width) a.vx *= -1;
      if (a.y < 0 || a.y > height) a.vy *= -1;

      // Draw connections
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONNECTION_DIST) {
          const opacity = (1 - dist / CONNECTION_DIST) * 0.15;
          ctx.strokeStyle = `rgba(0, 229, 255, ${opacity})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // Draw node
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0, 229, 255, ${a.opacity * 0.6})`;
      ctx.fill();

      // Glow
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.radius * 3, 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.radius * 3);
      gradient.addColorStop(0, `rgba(0, 229, 255, ${a.opacity * 0.15})`);
      gradient.addColorStop(1, 'rgba(0, 229, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    animationId = requestAnimationFrame(drawFrame);
  }

  resize();
  createNodes();
  drawFrame();

  window.addEventListener('resize', () => {
    resize();
    createNodes();
  });
}

/**
 * Create the navbar HTML
 */
export function createNavbar(role, session) {
  return `
    <nav class="navbar" id="navbar">
      <div class="navbar-brand">
        <svg viewBox="0 0 28 28" fill="none">
          <circle cx="14" cy="14" r="12" stroke="url(#nav-g)" stroke-width="1.5" fill="none"/>
          <circle cx="14" cy="14" r="3" fill="#00e5ff"/>
          <circle cx="8" cy="8" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <circle cx="20" cy="8" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <circle cx="8" cy="20" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <circle cx="20" cy="20" r="1.5" fill="#00e5ff" opacity="0.7"/>
          <line x1="14" y1="14" x2="8" y2="8" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <line x1="14" y1="14" x2="20" y2="8" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <line x1="14" y1="14" x2="8" y2="20" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <line x1="14" y1="14" x2="20" y2="20" stroke="#00e5ff" stroke-width="0.5" opacity="0.4"/>
          <defs><linearGradient id="nav-g" x1="0" y1="0" x2="28" y2="28">
            <stop stop-color="#00e5ff"/><stop offset="1" stop-color="#7c4dff"/>
          </linearGradient></defs>
        </svg>
        SoundMesh
      </div>
      <div class="navbar-actions">
        ${session ? `
          <span class="badge badge-primary">${session.roomName || 'Session'}</span>
          <span class="badge badge-success">
            <span class="status-dot status-dot--synced" style="width:6px;height:6px;"></span>
            ${role === 'host' ? 'Host' : 'Node'}
          </span>
        ` : ''}
      </div>
    </nav>
  `;
}
