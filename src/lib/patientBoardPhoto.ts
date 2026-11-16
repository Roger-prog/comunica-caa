const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function fileFormat(header: Uint8Array): string | null {
  if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)) return "image/png";
  if (String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function validBoardPhotoBlob(blob: Blob) {
  return IMAGE_TYPES.has(blob.type) && blob.size > 0 && blob.size <= MAX_OUTPUT_BYTES;
}

export async function renderBoardPhoto(source: CanvasImageSource, width: number, height: number, square: boolean) {
  if (width < 1 || height < 1 || width > 12000 || height > 12000 || width * height > 40_000_000) {
    throw new Error("A imagem tem dimensões inválidas ou muito grandes. Escolha outra imagem.");
  }
  const croppedWidth = square ? Math.min(width, height) : width;
  const croppedHeight = square ? croppedWidth : height;
  const scale = Math.min(1, 900 / Math.max(croppedWidth, croppedHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(croppedWidth * scale));
  canvas.height = Math.max(1, Math.round(croppedHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Seu navegador não conseguiu preparar a foto.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, (width - croppedWidth) / 2, (height - croppedHeight) / 2,
    croppedWidth, croppedHeight, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.84, 0.7, 0.52]) {
    // Encoding pixels into a new JPEG removes the source EXIF, including GPS.
    const result = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (result && validBoardPhotoBlob(result)) return result;
  }
  throw new Error("A foto preparada ultrapassa 2 MB. Escolha uma imagem menor.");
}

export async function prepareBoardPhoto(file: File, square: boolean) {
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error("Escolha um arquivo de imagem de até 12 MB.");
  const format = fileFormat(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!format || (file.type && file.type !== format)) throw new Error("Selecione uma imagem válida em JPEG, PNG ou WebP.");
  const inputUrl = URL.createObjectURL(file.slice(0, file.size, format));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Não foi possível abrir a imagem. Selecione outro arquivo."));
      image.src = inputUrl;
    });
    return await renderBoardPhoto(image, image.naturalWidth, image.naturalHeight, square);
  } finally {
    URL.revokeObjectURL(inputUrl);
  }
}
