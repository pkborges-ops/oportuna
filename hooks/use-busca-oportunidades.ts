"use client";

import { useMemo, useState } from "react";

import type { Opportunity } from "@/types";

export function useBuscaOportunidades(oportunidades: Opportunity[]) {
  const [termo, setTermo] = useState("");

  const resultados = useMemo(() => {
    const termoNormalizado = termo.trim().toLowerCase();

    if (!termoNormalizado) {
      return oportunidades;
    }

    return oportunidades.filter((oportunidade) => {
      const conteudo = [
        oportunidade.titulo,
        oportunidade.orgao,
        oportunidade.objeto,
        oportunidade.modalidade,
        ...oportunidade.tags,
      ]
        .join(" ")
        .toLowerCase();

      return conteudo.includes(termoNormalizado);
    });
  }, [oportunidades, termo]);

  return {
    termo,
    setTermo,
    resultados,
  };
}
