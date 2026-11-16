export const ARASAAC_TERMS_URL = "https://arasaac.org/terms-of-use";
export const ARASAAC_LICENSE_URL = "https://creativecommons.org/licenses/by-nc-sa/4.0/";
export const ARASAAC_CREDITS =
  "Pictogramas ARASAAC por Sergio Palao, propriedade do Governo de Aragão. Licença CC BY-NC-SA 4.0.";

export const isArasaacId = (id: unknown): id is number =>
  typeof id === "number" && Number.isSafeInteger(id) && id > 0 && id <= 2147483647;

export function getOfficialArasaacImageUrl(id: number): string {
  return isArasaacId(id) ? `https://static.arasaac.org/pictograms/${id}/${id}_500.png` : "";
}

export function getArasaacImageUrl(id: number): string {
  return isArasaacId(id) ? `/api/arasaac-image?id=${id}` : "";
}
