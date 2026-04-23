import type { SVGProps, ReactElement } from 'react';

/**
 * Icon set for podZAP. Each icon accepts native SVG props so
 * size/color/etc. can be overridden per-usage:
 *
 *   <Icons.Home />
 *   <Icons.Play width={24} height={24} />
 *   const { Group, Check } = Icons;
 *
 * All icons default to 18×18 and use `currentColor` so they inherit the
 * text color of their parent.
 */
export type IconProps = SVGProps<SVGSVGElement>;
export type IconComponent = (props: IconProps) => ReactElement;

const base = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
} as const;

export const Icons: Record<string, IconComponent> = {
  Play: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M7 5v14l12-7z" />
    </svg>
  ),
  Pause: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  ),
  Skip: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M6 5l8 7-8 7V5zM16 5h2v14h-2z" />
    </svg>
  ),
  Rewind: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M18 19l-8-7 8-7v14zM6 5h2v14H6z" />
    </svg>
  ),
  Check: (p) => (
    <svg {...base} {...p}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 12l6 6L20 6"
      />
    </svg>
  ),
  X: (p) => (
    <svg {...base} {...p}>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        d="M6 6l12 12M18 6l-12 12"
      />
    </svg>
  ),
  Mic: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 006 6.92V21h2v-3.08A7 7 0 0019 11h-2z"
      />
    </svg>
  ),
  Group: (p) => (
    <svg {...base} {...p}>
      <circle cx="9" cy="8" r="3" fill="currentColor" />
      <circle cx="17" cy="9" r="2.5" fill="currentColor" />
      <path
        fill="currentColor"
        d="M3 20c0-3 3-5 6-5s6 2 6 5v1H3v-1zm12-2c0-1 .5-2 1-2.5C18 15 21 16.5 21 19v1h-6v-2z"
      />
    </svg>
  ),
  Calendar: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm-2 8h14v10H5V10z"
      />
    </svg>
  ),
  History: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M13 3a9 9 0 00-9 9H1l4 4 4-4H6a7 7 0 117 7 7 7 0 01-4.95-2.05l-1.4 1.4A9 9 0 1013 3z"
      />
      <path fill="currentColor" d="M12 7v5l4 2 .75-1.23L13 11V7z" />
    </svg>
  ),
  Home: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z" />
    </svg>
  ),
  Sparkle: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"
      />
    </svg>
  ),
  Edit: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
      />
    </svg>
  ),
  Refresh: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M17.65 6.35A8 8 0 006.35 17.65L4.93 19.07A10 10 0 1019.07 4.93zM13 7v6l5 3 .75-1.23L14.5 12V7z"
      />
    </svg>
  ),
  Send: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M2 21l21-9L2 3v7l15 2-15 2z" />
    </svg>
  ),
  Settings: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M19.14 12.94a7.14 7.14 0 000-1.88l2.03-1.58-2-3.46-2.39.96a7 7 0 00-1.63-.94L14.78 3h-4l-.37 2.54a7 7 0 00-1.63.94l-2.39-.96-2 3.46 2.03 1.58a7.14 7.14 0 000 1.88l-2.03 1.58 2 3.46 2.39-.96a7 7 0 001.63.94l.37 2.54h4l.37-2.54a7 7 0 001.63-.94l2.39.96 2-3.46-2.03-1.58zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"
      />
    </svg>
  ),
  Wand: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L18 9.75 14.25 6 3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0L15 5.25 18.75 9l1.96-1.96z"
      />
    </svg>
  ),
  Volume: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 00-2.5-4v8a4.5 4.5 0 002.5-4z"
      />
    </svg>
  ),
  Bell: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M12 22a2 2 0 002-2h-4a2 2 0 002 2zm6-6V11a6 6 0 10-12 0v5l-2 2v1h16v-1l-2-2z"
      />
    </svg>
  ),
  Plus: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
    </svg>
  ),
  Chat: (p) => (
    <svg {...base} {...p}>
      <path
        fill="currentColor"
        d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H7l-4 4V6a2 2 0 011-2z"
      />
    </svg>
  ),
  Zap: (p) => (
    <svg {...base} {...p}>
      <path fill="currentColor" d="M13 2L3 14h7l-1 8 10-12h-7z" />
    </svg>
  ),
};

export type IconName = keyof typeof Icons;

export default Icons;
