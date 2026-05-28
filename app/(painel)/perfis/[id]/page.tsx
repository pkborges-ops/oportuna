import { notFound } from "next/navigation";

import { editarPerfil } from "@/app/(painel)/perfis/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { buscarPerfilPorId } from "@/services/perfis-service";

type EditarPerfilPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    erro?: string;
  }>;
};

const campoSelect =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";

export default async function EditarPerfilPage({
  params,
  searchParams,
}: EditarPerfilPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const perfil = await buscarPerfilPorId(id);

  if (!perfil) {
    notFound();
  }

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-2xl font-semibold text-slate-950">
          Editar perfil
        </h2>
        <p className="mt-1 text-slate-600">
          Atualize os dados usados para comparar editais com a empresa.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
          <CardDescription>
            As alterações afetam apenas o perfil selecionado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {query.erro ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              {query.erro}
            </div>
          ) : null}

          <form action={editarPerfil} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={perfil.id} />
            <Input
              label="Nome da empresa"
              name="nomeEmpresa"
              defaultValue={perfil.nomeEmpresa}
              required
            />
            <Input
              label="CNPJ"
              name="cnpj"
              defaultValue={perfil.cnpj}
              required
            />
            <Input
              label="Segmento"
              name="segmento"
              defaultValue={perfil.segmento}
              required
            />
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              <span>Porte</span>
              <select
                name="porte"
                className={campoSelect}
                defaultValue={perfil.porte}
              >
                <option value="MEI">MEI</option>
                <option value="ME">ME</option>
                <option value="EPP">EPP</option>
                <option value="Media">Media</option>
                <option value="Grande">Grande</option>
              </select>
            </label>
            <Input
              label="UF principal"
              name="uf"
              defaultValue={perfil.uf}
              maxLength={2}
              required
            />
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              <span>Status</span>
              <select
                name="status"
                className={campoSelect}
                defaultValue={perfil.status}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </label>
            <Input
              label="Palavras-chave"
              name="palavrasChave"
              defaultValue={perfil.palavrasChave.join(", ")}
              placeholder="SaaS, assinatura eletrônica, integração"
            />
            <div className="sm:col-span-2">
              <Button type="submit">Salvar alterações</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
