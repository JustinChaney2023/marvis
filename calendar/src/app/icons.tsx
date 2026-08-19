// Inline SVGs, not emoji — consistent rendering across platforms/fonts
// instead of relying on the OS's emoji set. `className` sizes/colors via
// currentColor + Tailwind (e.g. "h-4 w-4"); each defaults to a sensible
// stroke width for icon-scale use.

type IconProps = { className?: string };

export function LockIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 2a4 4 0 00-4 4v2H5a1 1 0 00-1 1v8a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-1V6a4 4 0 00-4-4zm2 6V6a2 2 0 10-4 0v2h4z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function RobotIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="4" y="8" width="16" height="11" rx="2" />
      <path d="M12 8V4m0 0h-2m2 0h2" strokeLinecap="round" />
      <circle cx="9" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
      <path d="M9 17h6" strokeLinecap="round" />
      <path d="M2 12h2m18 0h-2" strokeLinecap="round" />
    </svg>
  );
}

export function PersonIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" strokeLinecap="round" />
    </svg>
  );
}

// Built from geometry (8 teeth placed by angle) rather than a copied icon
// path, so the shape is verifiably correct instead of a recalled-from-
// memory path string that might not actually look like a gear.
export function GearIcon({ className = "h-4 w-4" }: IconProps) {
  const cx = 12;
  const cy = 12;
  const teeth = 8;
  const outerR = 10.5;
  const innerR = 8.2;
  const toothHalfAngle = (Math.PI / teeth) * 0.35;

  let path = "";
  for (let i = 0; i < teeth; i++) {
    const angle = (i / teeth) * Math.PI * 2;
    const a0 = angle - toothHalfAngle;
    const a1 = angle + toothHalfAngle;
    const nextInnerAngle = angle + Math.PI / teeth;
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
    path += `${i === 0 ? "M" : "L"} ${p(innerR, a0)} `;
    path += `L ${p(outerR, a0)} `;
    path += `L ${p(outerR, a1)} `;
    path += `L ${p(innerR, a1)} `;
    path += `L ${p(innerR, nextInnerAngle)} `;
  }
  path += "Z";

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d={path} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
      <circle cx={cx} cy={cy} r="3.4" className="fill-white dark:fill-zinc-900" />
    </svg>
  );
}

export function SunIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.5 14.5a8.5 8.5 0 01-11-11 8.5 8.5 0 1011 11z" />
    </svg>
  );
}

export function ChatIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-4 3.5V16H5.5A1.5 1.5 0 014 14.5v-9z"
      />
    </svg>
  );
}

export function CloseIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function PlusIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CalendarIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path strokeLinecap="round" d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}

export function ListIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path strokeLinecap="round" d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TargetIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BarsIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path strokeLinecap="round" d="M5 19V10M12 19V5M19 19v-6" />
    </svg>
  );
}

export function RepeatIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4" />
      <path strokeLinecap="round" d="M3 11V9a4 4 0 014-4h14" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 22l-4-4 4-4" />
      <path strokeLinecap="round" d="M21 13v2a4 4 0 01-4 4H3" />
    </svg>
  );
}

export function SparkleIcon({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11 2l1.3 4.9L17 8l-4.7 1.3L11 14l-1.3-4.7L5 8l4.7-1.1L11 2z" />
      <path d="M18.5 13l.8 2.9L22 16.7l-2.7.8-.8 2.8-.8-2.8-2.7-.8 2.7-.8.8-2.9z" />
    </svg>
  );
}

export function AlertTriangleIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.5L22 20.5H2L12 3.5z" />
      <path strokeLinecap="round" d="M12 10v4.5" />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FlagIcon({ className = "h-3 w-3" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M5 2.5a1 1 0 00-1 1V21a1 1 0 102 0v-6.2c1.1-.5 2.3-.8 3.5-.8 1.6 0 2.9.9 4.5.9 1.5 0 2.8-.4 4-1.1a1 1 0 00.5-.9V4.4a1 1 0 00-1.5-.9c-1 .6-2.1.9-3.5.9-1.6 0-2.9-.9-4.5-.9-1.2 0-2.4.3-3.5.8V3.5a1 1 0 00-1-1z" />
    </svg>
  );
}

export function UsersIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path strokeLinecap="round" d="M3 19c.9-3.2 3.2-5 6-5s5.1 1.8 6 5" />
      <path strokeLinecap="round" d="M16 4.5a3 3 0 010 6M18.5 19c-.5-2-1.6-3.5-3-4.4" />
    </svg>
  );
}
