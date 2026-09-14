export function interpretarNumeroControlePncp(codigo?: string | null) {
  const partes = codigo?.match(/^(\d{14})-1-(\d+)\/([1-9]\d{3})$/);

  if (!partes) {
    return null;
  }

  const [, cnpj, sequencialOriginal, ano] = partes;
  const sequencial = sequencialOriginal.replace(/^0+/, "");

  if (!sequencial) {
    return null;
  }

  return { cnpj, ano, sequencial };
}

export function formatarCnpj(cnpj: string) {
  return cnpj.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5",
  );
}
