import { criarPerfil } from "@/app/(painel)/perfis/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type NovoPerfilPageProps = {
  searchParams: Promise<{
    erro?: string;
  }>;
};

const campoSelect =
  "h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100";

export default async function NovoPerfilPage({
  searchParams,
}: NovoPerfilPageProps) {
  const params = await searchParams;

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-2xl font-semibold text-slate-950">Novo perfil</h2>
        <p className="mt-1 text-slate-600">
          Informe os dados que serao usados para comparar editais com a empresa.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Dados da empresa</CardTitle>
          <CardDescription>
            Cadastre as informações usadas para comparar editais com a empresa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {params.erro ? (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
              {params.erro}
            </div>
          ) : null}

          <form action={criarPerfil} className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Nome da empresa"
              name="nomeEmpresa"
              placeholder="Ex: Nortech Soluções Digitais"
              required
            />
            <Input
              label="CNPJ"
              name="cnpj"
              placeholder="00.000.000/0001-00"
              required
            />
            <Input
              label="Segmento"
              name="segmento"
              placeholder="Software, engenharia, saude..."
              required
            />
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              <span>Porte</span>
              <select name="porte" className={campoSelect} defaultValue="EPP">
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
              placeholder="SP"
              maxLength={2}
              required
            />
            <Input
              label="Palavras-chave"
              name="palavrasChave"
              placeholder="SaaS, assinatura eletrônica, integração"
            />
            <div className="sm:col-span-2">
              <Button type="submit">Salvar perfil</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
