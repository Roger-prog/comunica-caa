/**
 * Pictogramas próprios dos botões de controle da prancha (Opa!, páginas, Categorias).
 * São SVGs embutidos: aparecem sem internet e não dependem de nenhum catálogo externo.
 */
const common = { viewBox: "0 0 64 64", "aria-hidden": true, focusable: false } as const;

/** "Opa!": rostinho surpreso com gota de suor, para quando a criança toca na figura errada. */
export function OopsPictogram({ className }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <circle cx="30" cy="34" r="24" fill="#ffd43b" stroke="#2b2a33" strokeWidth="3" />
      <ellipse cx="21" cy="29" rx="3.5" ry="5" fill="#2b2a33" />
      <ellipse cx="39" cy="29" rx="3.5" ry="5" fill="#2b2a33" />
      <path d="M14 20 l8 -3 M46 20 l-8 -3" stroke="#2b2a33" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="30" cy="46" rx="6" ry="7" fill="#c92a2a" stroke="#2b2a33" strokeWidth="3" />
      <path d="M52 10 c4 6 6 9 0 13 c-6 -4 -4 -7 0 -13z" fill="#4dabf7" stroke="#2b2a33" strokeWidth="2.5" />
      <path d="M8 8 l5 5 M4 20 l7 0" stroke="#e03131" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

/** Página com seta: "próxima página" (e, espelhado, "página anterior"). */
export function PagePictogram({ className, direction = "next" }: { className?: string; direction?: "next" | "previous" }) {
  return (
    <svg {...common} className={className} style={direction === "previous" ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M8 6 h30 l12 12 v40 a2 2 0 0 1 -2 2 h-40 a2 2 0 0 1 -2 -2 v-50 a2 2 0 0 1 2 -2z"
        fill="#fff" stroke="#2b2a33" strokeWidth="3" strokeLinejoin="round" />
      <path d="M38 6 v12 h12" fill="#e7f0fb" stroke="#2b2a33" strokeWidth="3" strokeLinejoin="round" />
      <path d="M14 28 h20 M14 36 h14" stroke="#adb5bd" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="44" cy="46" r="13" fill="#2f80d8" stroke="#2b2a33" strokeWidth="3" />
      <path d="M38 46 h12 m-5 -6 l6 6 l-6 6" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pasta com quadradinhos coloridos: "categorias". */
export function CategoriesPictogram({ className }: { className?: string }) {
  return (
    <svg {...common} className={className}>
      <path d="M4 16 a4 4 0 0 1 4 -4 h16 l6 7 h26 a4 4 0 0 1 4 4 v28 a4 4 0 0 1 -4 4 h-48 a4 4 0 0 1 -4 -4z"
        fill="#ffd43b" stroke="#2b2a33" strokeWidth="3" strokeLinejoin="round" />
      <rect x="14" y="27" width="15" height="12" rx="3" fill="#e03131" stroke="#2b2a33" strokeWidth="2.5" />
      <rect x="33" y="27" width="15" height="12" rx="3" fill="#2f9e44" stroke="#2b2a33" strokeWidth="2.5" />
      <rect x="14" y="42" width="15" height="10" rx="3" fill="#2f80d8" stroke="#2b2a33" strokeWidth="2.5" />
      <rect x="33" y="42" width="15" height="10" rx="3" fill="#8b57c6" stroke="#2b2a33" strokeWidth="2.5" />
    </svg>
  );
}
