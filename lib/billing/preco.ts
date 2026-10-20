export function precoEmCentavos(valor: string | undefined): number | null {
  if (!valor || !/^\d+(?:\.\d{1,2})?$/.test(valor)) return null;
  const centavos = Math.round(Number(valor) * 100);
  return Number.isSafeInteger(centavos) && centavos > 0 ? centavos : null;
}
