import { sair } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/lib/app-config";

type AppHeaderProps = {
  nomeUsuario: string;
  emailUsuario: string;
};

function obterIniciais(nome: string) {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("")
    .toUpperCase();
}

export function AppHeader({ nomeUsuario, emailUsuario }: AppHeaderProps) {
  const iniciais = obterIniciais(nomeUsuario || emailUsuario) || "US";

  return (
    <header className="flex flex-col gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">Ambiente inicial</p>
        <h1 className="text-xl font-semibold text-slate-950">
          {appConfig.name}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden text-right text-sm sm:block">
          <p className="font-medium text-slate-950">{nomeUsuario}</p>
          <p className="text-slate-500">{emailUsuario}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-cyan-100 text-sm font-bold text-cyan-950">
          {iniciais}
        </div>
        <form action={sair}>
          <Button type="submit" variant="secondary">
            Sair
          </Button>
        </form>
      </div>
    </header>
  );
}
