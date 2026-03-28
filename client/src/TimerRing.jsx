function blend(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function focusStroke(urgency) {
  const t = Math.max(0, Math.min(1, urgency));
  const r = blend(100, 170, t);
  const g = blend(140, 200, t);
  const b = blend(255, 255, t);
  return `rgb(${r}, ${g}, ${b})`;
}

export default function TimerRing({ progress, urgency = 0, mode }) {
  const SIZE = 300;
  const R = 126;
  const C = 2 * Math.PI * R;
  const safeProgress = Math.max(0, Math.min(1, progress));
  const dashOffset = C * (1 - safeProgress);
  const safeUrgency = Math.max(0, Math.min(1, urgency));
  const stroke = mode === "focus" ? focusStroke(safeUrgency) : "#52C97A";
  const strokeWidth = mode === "focus" ? 8 + safeUrgency * 2 : 8;
  const glowStrength = mode === "focus" ? 0.2 + safeUrgency * 0.5 : 0.25;
  const glowBlur = mode === "focus" ? 6 + safeUrgency * 12 : 6;
  const CENTER = SIZE / 2;

  // Progress dot position
  const angle = -Math.PI / 2 + 2 * Math.PI * safeProgress;
  const dotX = CENTER + R * Math.cos(angle);
  const dotY = CENTER + R * Math.sin(angle);
  const dotSize = mode === "focus" ? 4 + safeUrgency * 2 : 4;

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
      <defs>
        <filter id="timer-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation={glowBlur} result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values={`1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${glowStrength} 0`}
          />
        </filter>
        <filter id="dot-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0.8 0"
          />
        </filter>
        <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={mode === "focus" ? "#5a7bff" : "#3bd084"} />
          <stop offset="50%" stopColor={stroke} />
          <stop offset="100%" stopColor={mode === "focus" ? "#a8bfff" : "#7eeaaa"} />
        </linearGradient>
      </defs>

      {/* Outer subtle track */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={R + 12}
        fill="none"
        stroke="rgba(255,255,255,0.03)"
        strokeWidth="1"
      />

      {/* Main track */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={R}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="8"
      />

      {/* Glow layer */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={R}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth + 4}
        strokeDasharray={C}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
        filter="url(#timer-glow)"
        opacity={0.6}
      />

      {/* Main progress ring */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={R}
        fill="none"
        stroke="url(#ring-gradient)"
        strokeWidth={strokeWidth}
        strokeDasharray={C}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
        style={{ transition: "stroke-width 350ms ease" }}
      />

      {/* Progress dot */}
      {safeProgress > 0.01 && safeProgress < 0.99 && (
        <>
          <circle
            cx={dotX}
            cy={dotY}
            r={dotSize + 3}
            fill={stroke}
            filter="url(#dot-glow)"
            opacity={0.5}
          />
          <circle
            cx={dotX}
            cy={dotY}
            r={dotSize}
            fill="#fff"
            style={{ transition: "r 200ms ease" }}
          />
        </>
      )}
    </svg>
  );
}
