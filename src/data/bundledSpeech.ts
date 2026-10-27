import francisca_agua from "../assets/voices/francisca/agua.mp3?inline";
import francisca_comer from "../assets/voices/francisca/comer.mp3?inline";
import francisca_banheiro from "../assets/voices/francisca/banheiro.mp3?inline";
import francisca_descansar from "../assets/voices/francisca/descansar.mp3?inline";
import francisca_ajuda from "../assets/voices/francisca/ajuda.mp3?inline";
import francisca_pausa from "../assets/voices/francisca/pausa.mp3?inline";
import francisca_feliz from "../assets/voices/francisca/feliz.mp3?inline";
import francisca_triste from "../assets/voices/francisca/triste.mp3?inline";
import francisca_dor from "../assets/voices/francisca/dor.mp3?inline";
import francisca_carinho from "../assets/voices/francisca/carinho.mp3?inline";
import francisca_brincar from "../assets/voices/francisca/brincar.mp3?inline";
import francisca_desenhar from "../assets/voices/francisca/desenhar.mp3?inline";
import francisca_ler from "../assets/voices/francisca/ler.mp3?inline";
import francisca_musica from "../assets/voices/francisca/musica.mp3?inline";
import francisca_mae from "../assets/voices/francisca/mae.mp3?inline";
import francisca_pai from "../assets/voices/francisca/pai.mp3?inline";
import francisca_familia from "../assets/voices/francisca/familia.mp3?inline";
import francisca_amigos from "../assets/voices/francisca/amigos.mp3?inline";
import francisca_casa from "../assets/voices/francisca/casa.mp3?inline";
import francisca_parque from "../assets/voices/francisca/parque.mp3?inline";
import francisca_ola from "../assets/voices/francisca/ola.mp3?inline";
import francisca_sim from "../assets/voices/francisca/sim.mp3?inline";
import francisca_nao from "../assets/voices/francisca/nao.mp3?inline";
import francisca_mais from "../assets/voices/francisca/mais.mp3?inline";
import antonio_agua from "../assets/voices/antonio/agua.mp3?inline";
import antonio_comer from "../assets/voices/antonio/comer.mp3?inline";
import antonio_banheiro from "../assets/voices/antonio/banheiro.mp3?inline";
import antonio_descansar from "../assets/voices/antonio/descansar.mp3?inline";
import antonio_ajuda from "../assets/voices/antonio/ajuda.mp3?inline";
import antonio_pausa from "../assets/voices/antonio/pausa.mp3?inline";
import antonio_feliz from "../assets/voices/antonio/feliz.mp3?inline";
import antonio_triste from "../assets/voices/antonio/triste.mp3?inline";
import antonio_dor from "../assets/voices/antonio/dor.mp3?inline";
import antonio_carinho from "../assets/voices/antonio/carinho.mp3?inline";
import antonio_brincar from "../assets/voices/antonio/brincar.mp3?inline";
import antonio_desenhar from "../assets/voices/antonio/desenhar.mp3?inline";
import antonio_ler from "../assets/voices/antonio/ler.mp3?inline";
import antonio_musica from "../assets/voices/antonio/musica.mp3?inline";
import antonio_mae from "../assets/voices/antonio/mae.mp3?inline";
import antonio_pai from "../assets/voices/antonio/pai.mp3?inline";
import antonio_familia from "../assets/voices/antonio/familia.mp3?inline";
import antonio_amigos from "../assets/voices/antonio/amigos.mp3?inline";
import antonio_casa from "../assets/voices/antonio/casa.mp3?inline";
import antonio_parque from "../assets/voices/antonio/parque.mp3?inline";
import antonio_ola from "../assets/voices/antonio/ola.mp3?inline";
import antonio_sim from "../assets/voices/antonio/sim.mp3?inline";
import antonio_nao from "../assets/voices/antonio/nao.mp3?inline";
import antonio_mais from "../assets/voices/antonio/mais.mp3?inline";

// Public, pre-generated vocabulary; inline imports perform no runtime download.
const clips = new Map<string, Map<string, string>>([
  ["pt-BR-FranciscaNeural", new Map([
    ["Água", francisca_agua],
    ["Comer", francisca_comer],
    ["Banheiro", francisca_banheiro],
    ["Descansar", francisca_descansar],
    ["Ajuda", francisca_ajuda],
    ["Pausa", francisca_pausa],
    ["Feliz", francisca_feliz],
    ["Triste", francisca_triste],
    ["Dor", francisca_dor],
    ["Carinho", francisca_carinho],
    ["Brincar", francisca_brincar],
    ["Desenhar", francisca_desenhar],
    ["Ler", francisca_ler],
    ["Música", francisca_musica],
    ["Mãe", francisca_mae],
    ["Pai", francisca_pai],
    ["Família", francisca_familia],
    ["Amigos", francisca_amigos],
    ["Casa", francisca_casa],
    ["Parque", francisca_parque],
    ["Olá", francisca_ola],
    ["Sim", francisca_sim],
    ["Não", francisca_nao],
    ["Mais", francisca_mais],
  ])],
  ["pt-BR-AntonioNeural", new Map([
    ["Água", antonio_agua],
    ["Comer", antonio_comer],
    ["Banheiro", antonio_banheiro],
    ["Descansar", antonio_descansar],
    ["Ajuda", antonio_ajuda],
    ["Pausa", antonio_pausa],
    ["Feliz", antonio_feliz],
    ["Triste", antonio_triste],
    ["Dor", antonio_dor],
    ["Carinho", antonio_carinho],
    ["Brincar", antonio_brincar],
    ["Desenhar", antonio_desenhar],
    ["Ler", antonio_ler],
    ["Música", antonio_musica],
    ["Mãe", antonio_mae],
    ["Pai", antonio_pai],
    ["Família", antonio_familia],
    ["Amigos", antonio_amigos],
    ["Casa", antonio_casa],
    ["Parque", antonio_parque],
    ["Olá", antonio_ola],
    ["Sim", antonio_sim],
    ["Não", antonio_nao],
    ["Mais", antonio_mais],
  ])],
]);

/** Decode only public built-in clips; the engine owns any retained Blob. */
export function getBundledSpeechAudio(text: string, voice: string): Blob | undefined {
  const source = clips.get(voice)?.get(text.trim());
  if (!source) return;
  const match = /^data:audio\/(?:mpeg|mp3);base64,(.+)$/.exec(source);
  if (!match) throw new Error("invalid_bundled_audio");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "audio/mpeg" });
}
