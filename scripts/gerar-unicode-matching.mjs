// Produz constantes Unicode para o SQL, sem acessar banco ou executar migration.
// Congela categorias/case mapping da mesma versão Unicode usada pela referência JS.
import { readFileSync, writeFileSync } from 'node:fs';
const file = 'supabase/oportunidades_paginadas_v1.sql';
function ranges(re) {
  const groups = []; let first = -1, last = -1;
  for (let n = 1; n <= 0x10ffff; n++) {
    if (n >= 0xd800 && n <= 0xdfff) continue;
    if (re.test(String.fromCodePoint(n))) {
      if (first < 0) first = n;
      last = n;
    } else if (first >= 0) { groups.push([first, last]); first = -1; }
  }
  if (first >= 0) groups.push([first,last]);
  return groups.map(([a,b]) => String.fromCodePoint(a) + (b === a ? '' : '-' + String.fromCodePoint(b))).join('');
}
let upper = '', lower = '', ufFrom = '', ufTo = '';
const expansions = [];
for (let n = 1; n <= 0x10ffff; n++) {
  if (n >= 0xd800 && n <= 0xdfff) continue;
  const c = String.fromCodePoint(n), l = c.toLowerCase();
  const u = c.toUpperCase();
  if (c !== u) {
    if ([...u].length === 1) { ufFrom += c; ufTo += u; }
    else expansions.push([c,u]);
  }
  // İ decompõe em I + marca antes do lowercase; os demais mappings são 1:1.
  if (c !== l && c !== 'İ') {
    if ([...l].length !== 1) throw Error('Mapping não suportado: ' + n);
    upper += c; lower += l;
  }
}
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const casedSignificativo = ranges({ test: c => /\p{Cased}/u.test(c) && !/\p{Case_Ignorable}/u.test(c) });
const generated = `-- Unicode ${process.versions.unicode}; gerado por scripts/gerar-unicode-matching.mjs.
create or replace function public.matching_normalizar_v1(valor text)
returns text language plpgsql immutable strict parallel safe
set search_path = pg_catalog as $fn$
declare
  texto text := normalize(valor, NFD);
  pos integer;
  sigma text;
begin
  texto := regexp_replace(texto collate "C", ${quote('[' + ranges(/\p{M}/u) + ']')}, '', 'g');
  -- Final_Sigma é a regra contextual de lowercase Unicode independente de locale.
  if strpos(texto, 'Σ') > 0 then
    for pos in 1..char_length(texto) loop
      if substr(texto, pos, 1) = 'Σ' then
        sigma := case when
          substr(texto, 1, pos - 1) collate "C" ~ ${quote('['+casedSignificativo+']['+ranges(/\p{Case_Ignorable}/u)+']*$')}
          and not (substr(texto, pos + 1) collate "C" ~ ${quote('^['+ranges(/\p{Case_Ignorable}/u)+']*['+casedSignificativo+']')})
          then 'ς' else 'σ' end;
        texto := overlay(texto placing sigma from pos for 1);
      end if;
    end loop;
  end if;
  texto := translate(texto, ${quote(upper)}, ${quote(lower)});
  texto := regexp_replace(texto collate "C", ${quote('[^'+ranges(/[\p{L}\p{N}]/u)+']+')}, ' ', 'g');
  return btrim(texto, ' ');
end;
$fn$;
create or replace function public.matching_upper_v1(valor text)
returns text language plpgsql immutable strict parallel safe
set search_path = pg_catalog as $fn$
declare texto text;
begin
  -- UF ASCII de duas letras: mesma conversão JS sem percorrer o mapa Unicode.
  if valor collate "C" ~ '^[A-Za-z]{2}$' then
    return translate(valor, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  end if;
  texto := translate(valor, ${quote(ufFrom)}, ${quote(ufTo)});
${expansions.map(([a,b]) => `  texto := replace(texto, ${quote(a)}, ${quote(b)});`).join('\n')}
  return texto;
end;
$fn$;
`;
const source = readFileSync(file,'utf8');
// Callback: os anchors "$" do regex SQL não são substituições especiais do JS.
const eol = source.includes('\r\n') ? '\r\n' : '\n';
const generatedWithEol = generated.replace(/\r?\n/g,eol);
const next = source.replace(/-- BEGIN UNICODE[\s\S]*?-- END UNICODE/, () => '-- BEGIN UNICODE'+eol+generatedWithEol+'-- END UNICODE');
if (process.argv.includes('--check')) {
  if (next !== source) throw Error('Constantes SQL divergentes; usar Node 24/Unicode correspondente.');
} else writeFileSync(file,next);
