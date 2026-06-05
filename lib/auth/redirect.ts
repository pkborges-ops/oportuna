export function obterDestinoSeguro(destino: unknown, fallback = "/dashboard") {
  if (typeof destino !== "string" || !destino.startsWith("/")) {
    return fallback;
  }

  if (destino.startsWith("//") || destino.startsWith("/login")) {
    return fallback;
  }

  return destino;
}
