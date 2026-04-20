// SoundMesh - Background Scheduler Worker
// This worker provides a high-precision clock that bypasses 
// main-thread throttling when the tab is in the background.

let timerId = null;
let intervalMs = 20;

self.onmessage = (e) => {
  const { action, interval } = e.data;

  if (action === 'start') {
    if (interval) intervalMs = interval;
    if (timerId) clearInterval(timerId);
    
    timerId = setInterval(() => {
      self.postMessage('tick');
    }, intervalMs);
  } else if (action === 'stop') {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }
};
