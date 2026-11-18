declare module "@diffusionstudio/piper-wasm/build/piper_phonemize.js" {
  export default function createPiperPhonemize(options: {
    locateFile: (name: string) => string;
    print: (output: string) => void;
    printErr: (output: string) => void;
  }): Promise<{ callMain: (args: string[]) => void }>;
}
