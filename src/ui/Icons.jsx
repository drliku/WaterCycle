const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const SunIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
  </svg>
)
export const RainIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M7 15.5a4.5 4.5 0 1 1 1.2-8.85A5.5 5.5 0 0 1 18.5 9a3.5 3.5 0 0 1-.5 6.5H7z" />
    <path d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5" />
  </svg>
)
export const SnowIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
    <path d="M9.5 3.8L12 5.5l2.5-1.7M9.5 20.2L12 18.5l2.5 1.7M4.3 10.3l2.7-.8-.6-2.9M17 16.5l2.7-.8-.6-2.9M4.3 13.7l2.7.8-.6 2.9M17 7.5l2.7.8-.6 2.9" />
  </svg>
)
export const PlayIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </svg>
)
export const PauseIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M8 4.5v15M16 4.5v15" strokeWidth="3" />
  </svg>
)
export const ResetIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 3.5v4.8h4.8" />
  </svg>
)
export const ThermoIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M14 14.8V4.5a2 2 0 1 0-4 0v10.3a4 4 0 1 0 4 0z" />
    <path d="M12 9v7" />
  </svg>
)
export const CloseIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)
export const DropIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 2.8C8 8 5.5 11.4 5.5 14.6a6.5 6.5 0 0 0 13 0c0-3.2-2.5-6.6-6.5-11.8z" fill="currentColor" stroke="none" />
  </svg>
)
