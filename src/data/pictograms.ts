export interface Pictogram {
  id: string;
  label: string;
  symbol: string;
  category: string;
  color: string;
}

// Text labels are the accessible source of meaning; emoji appearance varies by OS.
export const PICTOGRAMS: Pictogram[] = [
  {
    id: "agua",
    label: "Água",
    symbol: "💧",
    category: "Necessidades",
    color: "#eaf3fb",
  },
  {
    id: "comer",
    label: "Comer",
    symbol: "🍎",
    category: "Necessidades",
    color: "#fff0e5",
  },
  {
    id: "banheiro",
    label: "Banheiro",
    symbol: "🚽",
    category: "Necessidades",
    color: "#eaf3fb",
  },
  {
    id: "descansar",
    label: "Descansar",
    symbol: "🌙",
    category: "Necessidades",
    color: "#efebf9",
  },
  {
    id: "ajuda",
    label: "Ajuda",
    symbol: "🙋",
    category: "Necessidades",
    color: "#fff3d8",
  },
  {
    id: "pausa",
    label: "Pausa",
    symbol: "✋",
    category: "Necessidades",
    color: "#fff0e5",
  },
  {
    id: "feliz",
    label: "Feliz",
    symbol: "😊",
    category: "Sentimentos",
    color: "#fff3d8",
  },
  {
    id: "triste",
    label: "Triste",
    symbol: "😢",
    category: "Sentimentos",
    color: "#eaf3fb",
  },
  {
    id: "dor",
    label: "Dor",
    symbol: "🤕",
    category: "Sentimentos",
    color: "#fbecef",
  },
  {
    id: "carinho",
    label: "Carinho",
    symbol: "🤗",
    category: "Sentimentos",
    color: "#fbecef",
  },
  {
    id: "brincar",
    label: "Brincar",
    symbol: "🧸",
    category: "Atividades",
    color: "#fff0e5",
  },
  {
    id: "desenhar",
    label: "Desenhar",
    symbol: "🎨",
    category: "Atividades",
    color: "#efebf9",
  },
  {
    id: "ler",
    label: "Ler",
    symbol: "📖",
    category: "Atividades",
    color: "#eaf4ed",
  },
  {
    id: "musica",
    label: "Música",
    symbol: "🎵",
    category: "Atividades",
    color: "#efebf9",
  },
  {
    id: "mae",
    label: "Mãe",
    symbol: "👩",
    category: "Pessoas",
    color: "#fbecef",
  },
  {
    id: "pai",
    label: "Pai",
    symbol: "👨",
    category: "Pessoas",
    color: "#eaf3fb",
  },
  {
    id: "familia",
    label: "Família",
    symbol: "👪",
    category: "Pessoas",
    color: "#fff3d8",
  },
  {
    id: "amigos",
    label: "Amigos",
    symbol: "🧑‍🤝‍🧑",
    category: "Pessoas",
    color: "#eaf4ed",
  },
  {
    id: "casa",
    label: "Casa",
    symbol: "🏠",
    category: "Lugares",
    color: "#fff0e5",
  },
  {
    id: "parque",
    label: "Parque",
    symbol: "🌳",
    category: "Lugares",
    color: "#eaf4ed",
  },
  {
    id: "ola",
    label: "Olá",
    symbol: "👋",
    category: "Conversar",
    color: "#fff3d8",
  },
  {
    id: "sim",
    label: "Sim",
    symbol: "👍",
    category: "Conversar",
    color: "#eaf4ed",
  },
  {
    id: "nao",
    label: "Não",
    symbol: "👎",
    category: "Conversar",
    color: "#fbecef",
  },
  {
    id: "mais",
    label: "Mais",
    symbol: "➕",
    category: "Conversar",
    color: "#efebf9",
  },
];

export const CATEGORIES: string[] = [
  ...new Set(PICTOGRAMS.map((item) => item.category)),
];
