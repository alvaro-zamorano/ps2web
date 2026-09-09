// PS2WEB(Sprint 1): App shell = FPS stats + persistent library over OPFS.
// Overrides upstream App.tsx (single file input) with a product-grade library.
import './App.css';
import { useEffect, useState } from 'react';
import { useAppSelector } from './Actions';
import { Library } from './ps2web_library';

function Stats() {
  // PS2WEB(16): read the numbers the metrics tick already computed. The old code called
  // getFrames()+clearStats() here AND in ps2web_metrics.ts, so both counters saw a random split of
  // each second (the header showed 0-4 f/s while the game ran at 40+). Show flips/s and the true
  // emulation speed (vblanks/s vs the CRT rate) side by side.
  const [fps, setFps] = useState(0);
  const [speed, setSpeed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      try {
        const m = (window as any).__ps2web_metrics;
        if (m) { setFps(Math.round(m.fps)); setSpeed(Math.round(m.vmSpeedPct)); }
      } catch { /* module not ready */ }
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="ps2-fps" data-testid="ps2-fps">{fps} f/s · {speed}%</span>;
}

function App() {
  const state = useAppSelector((s) => s.play);
  const ready = state.value === 'initialized' || state.value === 'loaded';
  return (
    <div className="ps2-app">
      <div className="ps2-header">
        <span className="ps2-brand">ps2web</span>
        <Stats />
        <span className="ps2-version">{`v${process.env.REACT_APP_VERSION || 'dev'}`}</span>
      </div>
      <Library ready={ready} />
    </div>
  );
}

export default App;
