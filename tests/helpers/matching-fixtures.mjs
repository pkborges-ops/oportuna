// Casos compartilhados: expectativas são calculadas pela referência TS ao gerar SQL.
const basePerfil = { palavrasChave: ['software'], segmento: 'tecnologia', uf: 'SC' };
const baseOportunidade = { titulo: '', objeto: 'software tecnologia', tags: [], modalidade: '', uf: 'SC' };
const caso = (nome, perfil = {}, oportunidade = {}) => ({ nome, perfil: {...basePerfil,...perfil}, oportunidade: {...baseOportunidade,...oportunidade} });
export const casosMatching = [
  caso('65/25/10'),
  caso('somente palavras 65', {}, {objeto:'software', uf:'SP'}),
  caso('somente segmento 25', {}, {objeto:'tecnologia', uf:'SP'}),
  caso('somente UF 10', {}, {objeto:'hospital'}),
  caso('90/10 sem keywords', {palavrasChave:[]}),
  caso('sem keywords outra UF', {palavrasChave:[]}, {uf:'SP'}),
  caso('caixa', {palavrasChave:['SOFTWARE'], segmento:'TECNOLOGIA'}),
  caso('acentos', {palavrasChave:['gestão pública'], segmento:'licitações'}, {objeto:'GESTÃO PÚBLICA LICITAÇÕES'}),
  caso('NFD', {palavrasChave:['gestão']}, {objeto:'gesta\u0303o tecnologia'}),
  caso('pontuação', {palavrasChave:['gestão-pública']}, {objeto:'pública / gestão; tecnologia'}),
  caso('espaços', {palavrasChave:['  software\t'], segmento:'\n tecnologia '}),
  caso('NBSP BOM trim', {palavrasChave:['\uFEFFsoftware\u00a0'], uf:'\t sc\n'}),
  caso('frase separada', {palavrasChave:['gestão pública']}, {objeto:'gestão de compras da administração pública tecnologia'}),
  caso('frase incompleta', {palavrasChave:['gestão pública']}, {objeto:'gestão tecnologia'}),
  caso('palavra inteira', {palavrasChave:['obra']}, {objeto:'manobra tecnologia'}),
  caso('duplicadas', {palavrasChave:['Software', 'software', ' SOFTWARE ']}),
  caso('stopwords', {palavrasChave:['de','a','software de'], segmento:'da tecnologia para'}),
  caso('todas stopwords', {palavrasChave:['de','para','com']}),
  caso('stopwords mesmas palavras normalizadas diferentes', {palavrasChave:['software','software de']}),
  caso('segmento parcial', {segmento:'tecnologia hospitalar'}),
  caso('segmento repetido', {segmento:'tecnologia tecnologia'}),
  caso('UF diferente', {}, {uf:'SP'}),
  caso('UF vazia', {uf:''}, {uf:''}),
  caso('UF caixa e trim', {uf:'sc'}, {uf:' sc '}),
  caso('arredondamento meio', {segmento:'tecnologia hospitalar'}, {uf:'SP'}),
  caso('sem termos úteis', {palavrasChave:[], segmento:'de para'}, {uf:'SP'}),
  caso('tags e modalidade', {palavrasChave:['obra elétrica'], segmento:''}, {objeto:'',tags:['obra'],modalidade:'elétrica'}),
  caso('ligatura não expandida', {palavrasChave:['æther'], segmento:''}, {objeto:'aether',uf:'SP'}),
  caso('sigma final', {palavrasChave:['ΟΣ'],segmento:''}, {objeto:'ος',uf:'SP'}),
  caso('sigma não final', {palavrasChave:['ΟΣΑ'],segmento:''}, {objeto:'οσα',uf:'SP'}),
  caso('Unicode letras e números', {palavrasChave:['東京 １２'],segmento:''}, {objeto:'１２ 東京',uf:'SP'}),
  caso('status aberta', {}, {status:'aberta'}),
  caso('status encerrada', {}, {status:'encerrada'}),
];
// 90*k/n, sem palavras; exercita exatamente as fronteiras sem mudar fórmula.
for (const [score,k,n] of [[39,13,30],[40,4,9],[69,23,30],[70,7,9],[98,39,40]]) {
  const termos = Array.from({length:n},(_,i)=>'termo'+i);
  const bonus = score===98;
  casosMatching.push(caso('fronteira '+score, {palavrasChave:[],segmento:termos.join(' '),uf:bonus?'SC':'SP'},
    {objeto:termos.slice(0,k).join(' '),uf:'SC'}));
}
export const textosNormalizacao = ['GESTÃO pública', 'gesta\u0303o', ' æ Æ ß ø Œ ', 'ΟΣ ΟΣΑ ΑΣ’', 'İ İstanbul',
  '東京 １２ ٣', '𐐀𐐁 𝟠', 'emoji 🧑‍💻 software', '\uFEFFfoo\u00a0bar', 'á\u1ab0', 'um-dois/três', 'ação\n pública', 'ʰΣ', 'AʰΣ', 'AΣʰ', 'AΣʰA'];
