export const LOCAL_NEURAL_VOICES = [
  { voiceURI: "pt_BR-faber-medium", name: "Faber", lang: "pt-BR" },
  { voiceURI: "pt_BR-edresson-low", name: "Edresson", lang: "pt-BR" },
] as const;

export type LocalNeuralVoice = typeof LOCAL_NEURAL_VOICES[number]["voiceURI"];
export const DEFAULT_LOCAL_NEURAL_VOICE: LocalNeuralVoice = LOCAL_NEURAL_VOICES[0].voiceURI;

export function isLocalNeuralVoice(voiceURI?: string): voiceURI is LocalNeuralVoice {
  return LOCAL_NEURAL_VOICES.some((voice) => voice.voiceURI === voiceURI);
}
