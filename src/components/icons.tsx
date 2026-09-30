type P = React.SVGProps<SVGSVGElement>;
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "square" as const, strokeLinejoin: "miter" as const, "aria-hidden": true };

export const IconSearch = (p: P) => (<svg {...base} {...p}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>);
export const IconGrid = (p: P) => (<svg {...base} {...p}><path d="M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z" /></svg>);
export const IconReceipt = (p: P) => (<svg {...base} {...p}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>);
export const IconShelf = (p: P) => (<svg {...base} {...p}><path d="M4 20h16M6 20V6h3v14M11 20V4h3v16M16 20l2-13 3 .5-2 12.5" /></svg>);
export const IconWallet = (p: P) => (<svg {...base} {...p}><path d="M3 7h15v13H3zM18 11h3v5h-3a2.5 2.5 0 0 1 0-5zM5 7l10-4 1 4" /></svg>);
export const IconPen = (p: P) => (<svg {...base} {...p}><path d="m4 20 1-5L16 4l4 4L9 19zM13.5 6.5l4 4" /></svg>);
export const IconArrow = (p: P) => (<svg {...base} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
export const IconBack = (p: P) => (<svg {...base} {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>);
export const IconShare = (p: P) => (<svg {...base} {...p}><path d="M12 3v13M7 8l5-5 5 5M5 13v8h14v-8" /></svg>);
export const IconCopy = (p: P) => (<svg {...base} {...p}><path d="M8 8h12v12H8z" /><path d="M16 8V4H4v12h4" /></svg>);
export const IconCheck = (p: P) => (<svg {...base} {...p}><path d="m4 12 5 5L20 6" /></svg>);
export const IconClose = (p: P) => (<svg {...base} {...p}><path d="M5 5l14 14M19 5 5 19" /></svg>);
export const IconBook = (p: P) => (<svg {...base} {...p}><path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2zM12 6v14" /></svg>);
export const IconRemix = (p: P) => (<svg {...base} {...p}><path d="M4 7h11l-3-3M20 17H9l3 3M20 7l-3 3M4 17l3-3" /></svg>);
export const IconExternal = (p: P) => (<svg {...base} {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></svg>);
export const IconPlus = (p: P) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>);
export const IconMinus = (p: P) => (<svg {...base} {...p}><path d="M5 12h14" /></svg>);
export const IconBolt = (p: P) => (<svg {...base} {...p}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>);
export const IconSeries = (p: P) => (<svg {...base} {...p}><path d="M3 6h13v13H3zM7 3h14v13" /><path d="m7 15 3-4 2 2.5 2-1.5" /></svg>);
export const IconChevron = (p: P) => (<svg {...base} {...p}><path d="m9 6 6 6-6 6" /></svg>);
export const IconEye = (p: P) => (<svg {...base} {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>);
export const IconX = (p: P) => (<svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z" /></svg>);

/** Arbitrum's mark, simplified: the only place the chain's own shape appears. */
export const ArbMark = (p: P) => (
  <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden {...p}>
    <path d="M12 1.5 21.5 7v10L12 22.5 2.5 17V7z" fill="#213147" />
    <path d="m13.4 7.2 4.7 7.6-1.5.9-4-6.4zM10.6 7.2h1.9l-5 8.7-1.5-.9z" fill="#28a0f0" />
    <path d="m15.4 16.4 1.5-.9 1.2 2-1.4.8zM8.6 16.4l2.4-4 1 1.6-2 3.2z" fill="#fff" />
  </svg>
);
