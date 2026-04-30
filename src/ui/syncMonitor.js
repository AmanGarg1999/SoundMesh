// SoundMesh — Sync Monitor
// Real-time line chart showing per-device clock sync drift

import { clockSync } from '../core/clockSync.js';
import { audioPlayer } from '../core/audioPlayer.js';

const MAX_POINTS = 150;  // 30 seconds at 200ms interval
const TARGET_ZONE_MS = 5; // ±5ms target zone

/**
 * Initialize the sync monitor chart
 * @param {HTMLCanvasElement} canvas
 */
export function renderSyncMonitor(canvas) {
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dataPoints = [];
  let animationId;

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = 150 * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  resize();

  // Collect data points
  const collectInterval = setInterval(() => {
    const stats = clockSync.getStats();
    if (stats.sampleCount > 0) {
      dataPoints.push({
        time: Date.now(),
        offset: stats.avgOffset,
        variance: stats.offsetVariance,
        rtt: stats.avgRtt,
      });

      if (dataPoints.length > MAX_POINTS) {
        dataPoints.shift();
      }
    }
  }, 200);

  function draw() {
    animationId = requestAnimationFrame(draw);

    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    const padding = { top: 10, right: 10, bottom: 20, left: 40 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = 'rgba(6, 10, 20, 0.5)';
    ctx.fillRect(0, 0, width, height);

    // Target zone (±5ms)
    const maxRange = 20; // ±20ms y-axis
    const zoneTop = padding.top + chartH * (1 - (maxRange + TARGET_ZONE_MS) / (maxRange * 2));
    const zoneBottom = padding.top + chartH * (1 - (maxRange - TARGET_ZONE_MS) / (maxRange * 2));

    ctx.fillStyle = 'rgba(0, 230, 118, 0.05)';
    ctx.fillRect(padding.left, zoneTop, chartW, zoneBottom - zoneTop);
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.2)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, zoneTop);
    ctx.lineTo(padding.left + chartW, zoneTop);
    ctx.moveTo(padding.left, zoneBottom);
    ctx.lineTo(padding.left + chartW, zoneBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Zero line
    const zeroY = padding.top + chartH / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(padding.left + chartW, zeroY);
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`+${maxRange}ms`, padding.left - 4, padding.top + 10);
    ctx.fillText('0ms', padding.left - 4, zeroY + 4);
    ctx.fillText(`-${maxRange}ms`, padding.left - 4, height - padding.bottom);

    // ±5ms labels
    ctx.fillStyle = 'rgba(0, 230, 118, 0.4)';
    ctx.fillText('+5', padding.left - 4, zoneTop + 4);
    ctx.fillText('-5', padding.left - 4, zoneBottom + 4);

    // Draw data
    if (dataPoints.length < 2) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.textAlign = 'center';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Collecting sync data...', width / 2, height / 2);
      return;
    }

    // Offset line
    ctx.beginPath();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 6;

    for (let i = 0; i < dataPoints.length; i++) {
      const x = padding.left + (i / MAX_POINTS) * chartW;
      const normalizedOffset = Math.max(-maxRange, Math.min(maxRange, dataPoints[i].offset));
      const y = padding.top + chartH * (1 - (normalizedOffset + maxRange) / (maxRange * 2));

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Current value indicator
    if (dataPoints.length > 0) {
      const lastPoint = dataPoints[dataPoints.length - 1];
      const lastX = padding.left + ((dataPoints.length - 1) / MAX_POINTS) * chartW;
      const normalizedOffset = Math.max(-maxRange, Math.min(maxRange, lastPoint.offset));
      const lastY = padding.top + chartH * (1 - (normalizedOffset + maxRange) / (maxRange * 2));

      // Glowing dot
      ctx.beginPath();
      ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#00e5ff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(lastX, lastY, 8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';
      ctx.fill();

      // [Sync v8.1] Telemetry Overlay
      const apStats = audioPlayer.getStats();
      const isConverged = clockSync.isConverged();
      
      ctx.textAlign = 'right';
      ctx.font = 'bold 10px Inter, sans-serif';
      
      // Convergence Status
      ctx.fillStyle = isConverged ? '#00e676' : '#ff9100';
      ctx.fillText(`Sync: ${isConverged ? 'CONVERGED' : 'WAITING'}`, width - 10, padding.top + 10);
      
      // Error Stats
      if (apStats.chunkDropCount > 0 || apStats.decodeErrorCount > 0) {
        ctx.fillStyle = '#ff1744';
        ctx.fillText(`Drops: ${apStats.chunkDropCount} | Errors: ${apStats.decodeErrorCount}`, width - 10, padding.top + 25);
      }
    }
  }

  draw();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement);

  return () => {
    cancelAnimationFrame(animationId);
    clearInterval(collectInterval);
    resizeObserver.disconnect();
  };
}
