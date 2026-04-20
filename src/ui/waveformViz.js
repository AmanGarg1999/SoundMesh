// SoundMesh — Waveform Visualization
// Real-time audio waveform using AnalyserNode + Canvas

/**
 * Initialize waveform visualization on a canvas
 * @param {HTMLCanvasElement} canvas
 * @param {AnalyserNode} analyser
 * @returns {Function} cleanup function
 */
export function initWaveformViz(canvas, analyser) {
  if (!canvas || !analyser) return () => {};

  const ctx = canvas.getContext('2d');
  let animationId;
  let isRunning = true;

  // Set canvas size
  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  resize();

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function draw() {
    if (!isRunning) return;
    animationId = requestAnimationFrame(draw);

    analyser.getByteTimeDomainData(dataArray);

    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Draw background grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    const gridLines = 8;
    for (let i = 1; i < gridLines; i++) {
      const y = (height / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Center line
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw waveform
    const sliceWidth = width / bufferLength;
    let x = 0;

    // Glow effect
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;

    // Main waveform line
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.stroke();

    // Secondary glow line (slightly offset)
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.3)';
    ctx.beginPath();
    x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2 + 1;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      x += sliceWidth;
    }

    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;
  }

  draw();

  // Handle resize
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas.parentElement);

  // Return cleanup function
  return () => {
    isRunning = false;
    if (animationId) cancelAnimationFrame(animationId);
    resizeObserver.disconnect();
  };
}
