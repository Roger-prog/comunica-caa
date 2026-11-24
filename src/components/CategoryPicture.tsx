import { FolderOpen, Gauge, HandHelping, Link2, MessageCircle } from "lucide-react";
import { ArasaacImage } from "./ArasaacPicker";

// Pictogramas revisados do catálogo do Comunica, escolhidos para representar cada grupo.
const images = new Map([
  ["animais", 2517], // cachorro
  ["apontar-e-quantidade", 3220], // mais
  ["atendimento", 2467], // médico
  ["atividades", 23392], // brincar
  ["conversar", 6522], // olá
  ["cores", 4869], // azul
  ["descricao", 4658], // grande
  ["igual-diferentes-e-junto", 32392], // igual
  ["lugar-e-posicao", 5388], // em cima
  ["lugares", 2317], // casa
  ["necessidades", 2248], // água
  ["numeros-ordem-e-fases", 2627], // um
  ["objetos", 3129], // mesa
  ["palavras-de-perguntas", 22620], // o que
  ["palavras-sociais", 6028], // tchau
  ["partes-do-corpo", 2928], // mão
  ["pessoas", 38351], // família
  ["pessoas-e-familias", 38351], // família
  ["pronomes", 6632], // eu
  ["sentimentos", 9907], // feliz
  ["sintomas", 32530], // febre
  ["tempo-dos-sintomas", 38276], // hoje
  ["tempo-e-modo", 32747], // agora
  ["verbos-de-acao", 2349], // comer
]);

const categoryIcons = new Map([
  ["comunicacao-durante-a-consulta", MessageCircle],
  ["conectores", Link2],
  ["intensidade", Gauge],
  ["verbos-ajudantes", HandHelping],
]);

export function CategoryPicture({ categoryId, override }: { categoryId: string; override?: number }) {
  const id = override ?? images.get(categoryId);
  const Icon = categoryIcons.get(categoryId) ?? FolderOpen;
  const fallback = <Icon className="size-10" />;

  return <span aria-hidden="true" className="flex size-16 max-w-full shrink-0 items-center justify-center overflow-hidden rounded-xl">
    {id ? <ArasaacImage id={id} alt="" className="size-full object-contain" fallback={fallback} /> : fallback}
  </span>;
}
