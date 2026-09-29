-- APLICAR MANUALMENTE em homologação antes de produção. PostgreSQL UTF8 >= 15.
-- Uma migration, nenhuma tabela nova e nenhum score persistido.
-- ALTER TABLE de colunas STORED materializa o backfill e requer janela de lock.
begin;
set local lock_timeout = '5s';
create extension if not exists pg_trgm;

-- BEGIN UNICODE
-- Unicode 17.0; gerado por scripts/gerar-unicode-matching.mjs.
create or replace function public.matching_normalizar_v1(valor text)
returns text language plpgsql immutable strict parallel safe
set search_path = pg_catalog as $fn$
declare
  texto text := normalize(valor, NFD);
  pos integer;
  sigma text;
begin
  texto := regexp_replace(texto collate "C", '[̀-ͯ҃-҉֑-ֽֿׁ-ׂׄ-ׇׅؐ-ًؚ-ٰٟۖ-ۜ۟-ۤۧ-۪ۨ-ܑۭܰ-݊ަ-ް߫-߽߳ࠖ-࠙ࠛ-ࠣࠥ-ࠧࠩ-࡙࠭-࡛ࢗ-࢟࣊-ࣣ࣡-ःऺ-़ा-ॏ॑-ॗॢ-ॣঁ-ঃ়া-ৄে-ৈো-্ৗৢ-ৣ৾ਁ-ਃ਼ਾ-ੂੇ-ੈੋ-੍ੑੰ-ੱੵઁ-ઃ઼ા-ૅે-ૉો-્ૢ-ૣૺ-૿ଁ-ଃ଼ା-ୄେ-ୈୋ-୍୕-ୗୢ-ୣஂா-ூெ-ைொ-்ௗఀ-ఄ఼ా-ౄె-ైొ-్ౕ-ౖౢ-ౣಁ-ಃ಼ಾ-ೄೆ-ೈೊ-್ೕ-ೖೢ-ೣೳഀ-ഃ഻-഼ാ-ൄെ-ൈൊ-്ൗൢ-ൣඁ-ඃ්ා-ුූෘ-ෟෲ-ෳัิ-ฺ็-๎ັິ-ຼ່-໎༘-༹༙༵༷༾-༿ཱ-྄྆-྇ྍ-ྗྙ-ྼ࿆ါ-ှၖ-ၙၞ-ၠၢ-ၤၧ-ၭၱ-ၴႂ-ႍႏႚ-ႝ፝-፟ᜒ-᜕ᜲ-᜴ᝒ-ᝓᝲ-ᝳ឴-៓៝᠋-᠍᠏ᢅ-ᢆᢩᤠ-ᤫᤰ-᤻ᨗ-ᨛᩕ-ᩞ᩠-᩿᩼᪰-᫝᫠-᫫ᬀ-ᬄ᬴-᭄᭫-᭳ᮀ-ᮂᮡ-ᮭ᯦-᯳ᰤ-᰷᳐-᳔᳒-᳨᳭᳴᳷-᳹᷀-᷿⃐-⃰⳯-⵿⳱ⷠ-〪ⷿ-゙〯-゚꙯-꙲ꙴ-꙽ꚞ-ꚟ꛰-꛱ꠂ꠆ꠋꠣ-ꠧ꠬ꢀ-ꢁꢴ-ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-꥓ꦀ-ꦃ꦳-꧀ꧥꨩ-ꨶꩃꩌ-ꩍꩻ-ꩽꪰꪲ-ꪴꪷ-ꪸꪾ-꪿꫁ꫫ-ꫯꫵ-꫶ꯣ-ꯪ꯬-꯭ﬞ︀-️︠-𐇽𐋠︯𐍶-𐍺𐨁-𐨃𐨅-𐨆𐨌-𐨏𐨸-𐨿𐨺𐫥-𐫦𐴤-𐴧𐵩-𐵭𐺫-𐺬𐻺-𐻿𐽆-𐽐𐾂-𐾅𑀀-𑀂𑀸-𑁆𑁰𑁳-𑁴𑁿-𑂂𑂰-𑂺𑃂𑄀-𑄂𑄧-𑄴𑅅-𑅆𑅳𑆀-𑆂𑆳-𑇀𑇉-𑇌𑇎-𑇏𑈬-𑈷𑈾𑉁𑋟-𑋪𑌀-𑌃𑌻-𑌼𑌾-𑍄𑍇-𑍈𑍋-𑍍𑍗𑍢-𑍣𑍦-𑍬𑍰-𑍴𑎸-𑏀𑏅𑏅𑎸-𑏊𑏌-𑏐𑏒𑏡-𑏢𑐵-𑑆𑑞𑒰-𑓃𑖯-𑖵𑖸-𑗀𑗜-𑗝𑘰-𑙀𑚫-𑚷𑜝-𑜫𑠬-𑠺𑤰-𑤵𑤷-𑤸𑤻-𑤾𑥀𑥂-𑥃𑧑-𑧗𑧚-𑧠𑧤𑨁-𑨊𑨳-𑨹𑨻-𑨾𑩇𑩑-𑩛𑪊-𑪙𑭠-𑭧𑰯-𑰶𑰸-𑰿𑲒-𑲧𑲩-𑲶𑴱-𑴶𑴺𑴼-𑴽𑴿-𑵅𑵇𑶊-𑶎𑶐-𑶑𑶓-𑶗𑻳-𑻶𑼀-𑼁𑼃𑼴-𑼺𑼾-𑽂𑽚𓑀𓑇-𓑕𖄞-𖫰𖄯-𖫴𖬰-𖬶𖽏𖽑-𖾇𖾏-𖾒𖿤𖿰-𖿱𛲝-𛲞𜼀-𜼭𜼰-𜽆𝅥-𝅩𝅭-𝅲𝅻-𝆂𝆅-𝆋𝆪-𝆭𝉂-𝉄𝨀-𝨶𝨻-𝩬𝩵𝪄𝪛-𝪟𝪡-𝪯𞀀-𞀆𞀈-𞀘𞀛-𞀡𞀣-𞀤𞀦-𞀪𞂏𞄰-𞄶𞊮𞋬-𞋯𞓬-𞓯𞗮-𞗯𞛣𞛦𞛮-𞛯𞛵𞣐-𞣖𞥄-𞥊󠄀-󠇯]', '', 'g');
  -- Final_Sigma é a regra contextual de lowercase Unicode independente de locale.
  if strpos(texto, 'Σ') > 0 then
    for pos in 1..char_length(texto) loop
      if substr(texto, pos, 1) = 'Σ' then
        sigma := case when
          substr(texto, 1, pos - 1) collate "C" ~ '[A-Za-zªµºÀ-ÖØ-öø-ƺƼ-ƿǄ-ʓʖ-ʯͰ-ͳͶ-ͷͻ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՠ-ֈႠ-ჅჇჍა-ჺჽ-ჿᎠ-Ᏽᏸ-ᏽᲀ-ᲊᲐ-ᲺᲽ-Ჿᴀ-ᴫᵫ-ᵷᵹ-ᶚḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℴℹℼ-ℿⅅ-ⅉⅎⅠ-ⅿↃ-ↄⒶ-ⓩⰀ-ⱻⱾ-ⳤⳫ-ⳮⳲ-ⳳⴀ-ⴥⴧⴭꙀ-ꙭꚀ-ꚛꜢ-ꝯꝱ-ꞇꞋ-ꞎꞐ-ꟜꟵ-ꟶꟺꬰ-ꭚꭠ-ꭨꭰ-ꮿﬀ-ﬆﬓ-ﬗＡ-Ｚａ-ｚ𐐀-𐑏𐒰-𐓓𐓘-𐓻𐕰-𐕺𐕼-𐖊𐖌-𐖒𐖔-𐖕𐖗-𐖡𐖣-𐖱𐖳-𐖹𐖻-𐖼𐲀-𐲲𐳀-𐳲𐵐-𐵥𐵰-𐶅𑢠-𑣟𖹀-𖹿𖺠-𖺸𖺻-𖻓𝐀-𝑔𝑖-𝒜𝒞-𝒟𝒢𝒥-𝒦𝒩-𝒬𝒮-𝒹𝒻𝒽-𝓃𝓅-𝔅𝔇-𝔊𝔍-𝔔𝔖-𝔜𝔞-𝔹𝔻-𝔾𝕀-𝕄𝕆𝕊-𝕐𝕒-𝚥𝚨-𝛀𝛂-𝛚𝛜-𝛺𝛼-𝜔𝜖-𝜴𝜶-𝝎𝝐-𝝮𝝰-𝞈𝞊-𝞨𝞪-𝟂𝟄-𝟋𝼀-𝼉𝼋-𝼞𝼥-𝼪𞤀-𞥃🄰-🅉🅐-🅩🅰-🆉][''.:^`¨­¯´·-¸ʰ-ͯʹ-͵ͺ΄-΅·҃-҉ՙ՟֑-ֽֿׁ-ׂׄ-ׇׅ״؀-؅ؐ-ؚ؜ـً-ٰٟۖ-۝۟-۪ۨ-ۭ܏ܑܰ-݊ަ-ް߫-ߵߺ߽ࠖ-࡙࠭-࡛࢈࢐-࢑ࢗ-࢟ࣉ-ंऺ़ु-ै्॑-ॗॢ-ॣॱঁ়ু-ৄ্ৢ-ৣ৾ਁ-ਂ਼ੁ-ੂੇ-ੈੋ-੍ੑੰ-ੱੵઁ-ં઼ુ-ૅે-ૈ્ૢ-ૣૺ-૿ଁ଼ିୁ-ୄ୍୕-ୖୢ-ୣஂீ்ఀఄ఼ా-ీె-ైొ-్ౕ-ౖౢ-ౣಁ಼ಿೆೌ-್ೢ-ೣഀ-ഁ഻-഼ു-ൄ്ൢ-ൣඁ්ි-ුූัิ-ฺๆ-๎ັິ-ຼໆ່-໎༘-ཱ༹༙༵༷-ཾྀ-྄྆-྇ྍ-ྗྙ-ྼ࿆ိ-ူဲ-့္-်ွ-ှၘ-ၙၞ-ၠၱ-ၴႂႅ-ႆႍႝჼ፝-፟ᜒ-᜔ᜲ-ᜳᝒ-ᝓᝲ-ᝳ឴-឵ិ-ួំ៉-៓ៗ៝᠋-᠏ᡃᢅ-ᢆᢩᤠ-ᤢᤧ-ᤨᤲ᤹-᤻ᨗ-ᨘᨛᩖᩘ-ᩞ᩠ᩢᩥ-ᩬᩳ-᩿᩼ᪧ᪰-᫝᫠-᫫ᬀ-ᬃ᬴ᬶ-ᬺᬼᭂ᭫-᭳ᮀ-ᮁᮢ-ᮥᮨ-ᮩ᮫-ᮭ᯦ᯨ-ᯩᯭᯯ-ᯱᰬ-ᰳᰶ-᰷ᱸ-ᱽ᳐-᳔᳒-᳢᳠-᳨᳭᳴᳸-᳹ᴬ-ᵪᵸᶛ-᷿᾽᾿-῁῍-῏῝-῟῭-`´-῾​-‏‘-’․‧‪-‮⁠-⁤⁦-⁯ⁱⁿₐ-ₜ⃐-⃰ⱼ-ⱽ⳯-⳱ⵯ⵿ⷠ-ⷿⸯ々〪-〭〱-〵〻゙-ゞー-ヾꀕꓸ-ꓽꘌ꙯-꙲ꙴ-꙽ꙿꚜ-ꚟ꛰-꛱꜀-꜡ꝰꞈ-꞊꟱-ꟴꟸ-ꟹꠂ꠆ꠋꠥ-ꠦ꠬꣄-ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-ꥑꦀ-ꦂ꦳ꦶ-ꦹꦼ-ꦽꧏꧥ-ꧦꨩ-ꨮꨱ-ꨲꨵ-ꨶꩃꩌꩰꩼꪰꪲ-ꪴꪷ-ꪸꪾ-꪿꫁ꫝꫬ-ꫭꫳ-ꫴ꫶꭛-ꭟꭩ-꭫ꯥꯨ꯭ﬞ﮲-﯂︀-️︓︠-︯﹒﹕﻿＇．：＾｀ｰﾞ-ﾟ￣￹-￻𐇽𐋠𐍶-𐍺𐞀-𐞅𐞇-𐞰𐞲-𐞺𐨁-𐨃𐨅-𐨆𐨌-𐨏𐨸-𐨿𐨺𐫥-𐫦𐴤-𐴧𐵎𐵩-𐵭𐵯𐺫-𐺬𐻅𐻺-𐻿𐽆-𐽐𐾂-𐾅𑀁𑀸-𑁆𑁰𑁳-𑁴𑁿-𑂁𑂳-𑂶𑂹-𑂺𑂽𑃂𑃍𑄀-𑄂𑄧-𑄫𑄭-𑅳𑄴𑆀-𑆁𑆶-𑆾𑇉-𑇌𑇏𑈯-𑈱𑈴𑈶-𑈷𑈾𑉁𑋟𑋣-𑋪𑌀-𑌁𑌻-𑌼𑍀𑍦-𑍬𑍰-𑍴𑎻-𑏀𑏎𑏐𑏒𑏡-𑏢𑐸-𑐿𑑂-𑑄𑑆𑑞𑒳-𑒸𑒺𑒿-𑓀𑓂-𑓃𑖲-𑖵𑖼-𑖽𑖿-𑗀𑗜-𑗝𑘳-𑘺𑘽𑘿-𑙀𑚫𑚭𑚰-𑚵𑚷𑜝𑜟𑜢-𑜥𑜧-𑜫𑠯-𑠷𑠹-𑠺𑤻-𑤼𑥃𑤾𑧔-𑧗𑧚-𑧛𑧠𑨁-𑨊𑨳-𑨸𑨻-𑨾𑩇𑩑-𑩖𑩙-𑩛𑪊-𑪖𑪘-𑪙𑭠𑭢-𑭤𑭦𑰰-𑰶𑰸-𑰽𑰿𑲒-𑲧𑲪-𑲰𑲲-𑲳𑲵-𑲶𑴱-𑴶𑴺𑴼-𑴽𑴿-𑵅𑵇𑶐-𑶑𑶕𑶗𑷙𑻳-𑻴𑼀-𑼁𑼶-𑼺𑽀𑽂𑽚𓐰-𓑀𓑇-𓑕𖄞-𖄩𖄭-𖫰𖄯-𖫴𖬰-𖬶𖭀-𖭃𖵀-𖵂𖵫-𖵬𖽏𖾏-𖾟𖿠-𖿡𖿣-𖿤𖿲-𖿳𚿰-𚿳𚿵-𚿻𚿽-𚿾𛲝-𛲞𛲠-𛲣𜼀-𜼭𜼰-𜽆𝅧-𝅩𝅳-𝆂𝆅-𝆋𝆪-𝆭𝉂-𝉄𝨀-𝨶𝨻-𝩬𝩵𝪄𝪛-𝪟𝪡-𝪯𞀀-𞀆𞀈-𞀘𞀛-𞀡𞀣-𞀤𞀦-𞀪𞀰-𞁭𞂏𞄰-𞄽𞊮𞋬-𞋯𞓫-𞓯𞗮-𞗯𞛣𞛦𞛮-𞛯𞛵𞛿𞣐-𞣖𞥄-𞥋🏻-🏿󠀁󠀠-󠁿󠄀-󠇯]*$'
          and not (substr(texto, pos + 1) collate "C" ~ '^[''.:^`¨­¯´·-¸ʰ-ͯʹ-͵ͺ΄-΅·҃-҉ՙ՟֑-ֽֿׁ-ׂׄ-ׇׅ״؀-؅ؐ-ؚ؜ـً-ٰٟۖ-۝۟-۪ۨ-ۭ܏ܑܰ-݊ަ-ް߫-ߵߺ߽ࠖ-࡙࠭-࡛࢈࢐-࢑ࢗ-࢟ࣉ-ंऺ़ु-ै्॑-ॗॢ-ॣॱঁ়ু-ৄ্ৢ-ৣ৾ਁ-ਂ਼ੁ-ੂੇ-ੈੋ-੍ੑੰ-ੱੵઁ-ં઼ુ-ૅે-ૈ્ૢ-ૣૺ-૿ଁ଼ିୁ-ୄ୍୕-ୖୢ-ୣஂீ்ఀఄ఼ా-ీె-ైొ-్ౕ-ౖౢ-ౣಁ಼ಿೆೌ-್ೢ-ೣഀ-ഁ഻-഼ു-ൄ്ൢ-ൣඁ්ි-ුූัิ-ฺๆ-๎ັິ-ຼໆ່-໎༘-ཱ༹༙༵༷-ཾྀ-྄྆-྇ྍ-ྗྙ-ྼ࿆ိ-ူဲ-့္-်ွ-ှၘ-ၙၞ-ၠၱ-ၴႂႅ-ႆႍႝჼ፝-፟ᜒ-᜔ᜲ-ᜳᝒ-ᝓᝲ-ᝳ឴-឵ិ-ួំ៉-៓ៗ៝᠋-᠏ᡃᢅ-ᢆᢩᤠ-ᤢᤧ-ᤨᤲ᤹-᤻ᨗ-ᨘᨛᩖᩘ-ᩞ᩠ᩢᩥ-ᩬᩳ-᩿᩼ᪧ᪰-᫝᫠-᫫ᬀ-ᬃ᬴ᬶ-ᬺᬼᭂ᭫-᭳ᮀ-ᮁᮢ-ᮥᮨ-ᮩ᮫-ᮭ᯦ᯨ-ᯩᯭᯯ-ᯱᰬ-ᰳᰶ-᰷ᱸ-ᱽ᳐-᳔᳒-᳢᳠-᳨᳭᳴᳸-᳹ᴬ-ᵪᵸᶛ-᷿᾽᾿-῁῍-῏῝-῟῭-`´-῾​-‏‘-’․‧‪-‮⁠-⁤⁦-⁯ⁱⁿₐ-ₜ⃐-⃰ⱼ-ⱽ⳯-⳱ⵯ⵿ⷠ-ⷿⸯ々〪-〭〱-〵〻゙-ゞー-ヾꀕꓸ-ꓽꘌ꙯-꙲ꙴ-꙽ꙿꚜ-ꚟ꛰-꛱꜀-꜡ꝰꞈ-꞊꟱-ꟴꟸ-ꟹꠂ꠆ꠋꠥ-ꠦ꠬꣄-ꣅ꣠-꣱ꣿꤦ-꤭ꥇ-ꥑꦀ-ꦂ꦳ꦶ-ꦹꦼ-ꦽꧏꧥ-ꧦꨩ-ꨮꨱ-ꨲꨵ-ꨶꩃꩌꩰꩼꪰꪲ-ꪴꪷ-ꪸꪾ-꪿꫁ꫝꫬ-ꫭꫳ-ꫴ꫶꭛-ꭟꭩ-꭫ꯥꯨ꯭ﬞ﮲-﯂︀-️︓︠-︯﹒﹕﻿＇．：＾｀ｰﾞ-ﾟ￣￹-￻𐇽𐋠𐍶-𐍺𐞀-𐞅𐞇-𐞰𐞲-𐞺𐨁-𐨃𐨅-𐨆𐨌-𐨏𐨸-𐨿𐨺𐫥-𐫦𐴤-𐴧𐵎𐵩-𐵭𐵯𐺫-𐺬𐻅𐻺-𐻿𐽆-𐽐𐾂-𐾅𑀁𑀸-𑁆𑁰𑁳-𑁴𑁿-𑂁𑂳-𑂶𑂹-𑂺𑂽𑃂𑃍𑄀-𑄂𑄧-𑄫𑄭-𑅳𑄴𑆀-𑆁𑆶-𑆾𑇉-𑇌𑇏𑈯-𑈱𑈴𑈶-𑈷𑈾𑉁𑋟𑋣-𑋪𑌀-𑌁𑌻-𑌼𑍀𑍦-𑍬𑍰-𑍴𑎻-𑏀𑏎𑏐𑏒𑏡-𑏢𑐸-𑐿𑑂-𑑄𑑆𑑞𑒳-𑒸𑒺𑒿-𑓀𑓂-𑓃𑖲-𑖵𑖼-𑖽𑖿-𑗀𑗜-𑗝𑘳-𑘺𑘽𑘿-𑙀𑚫𑚭𑚰-𑚵𑚷𑜝𑜟𑜢-𑜥𑜧-𑜫𑠯-𑠷𑠹-𑠺𑤻-𑤼𑥃𑤾𑧔-𑧗𑧚-𑧛𑧠𑨁-𑨊𑨳-𑨸𑨻-𑨾𑩇𑩑-𑩖𑩙-𑩛𑪊-𑪖𑪘-𑪙𑭠𑭢-𑭤𑭦𑰰-𑰶𑰸-𑰽𑰿𑲒-𑲧𑲪-𑲰𑲲-𑲳𑲵-𑲶𑴱-𑴶𑴺𑴼-𑴽𑴿-𑵅𑵇𑶐-𑶑𑶕𑶗𑷙𑻳-𑻴𑼀-𑼁𑼶-𑼺𑽀𑽂𑽚𓐰-𓑀𓑇-𓑕𖄞-𖄩𖄭-𖫰𖄯-𖫴𖬰-𖬶𖭀-𖭃𖵀-𖵂𖵫-𖵬𖽏𖾏-𖾟𖿠-𖿡𖿣-𖿤𖿲-𖿳𚿰-𚿳𚿵-𚿻𚿽-𚿾𛲝-𛲞𛲠-𛲣𜼀-𜼭𜼰-𜽆𝅧-𝅩𝅳-𝆂𝆅-𝆋𝆪-𝆭𝉂-𝉄𝨀-𝨶𝨻-𝩬𝩵𝪄𝪛-𝪟𝪡-𝪯𞀀-𞀆𞀈-𞀘𞀛-𞀡𞀣-𞀤𞀦-𞀪𞀰-𞁭𞂏𞄰-𞄽𞊮𞋬-𞋯𞓫-𞓯𞗮-𞗯𞛣𞛦𞛮-𞛯𞛵𞛿𞣐-𞣖𞥄-𞥋🏻-🏿󠀁󠀠-󠁿󠄀-󠇯]*[A-Za-zªµºÀ-ÖØ-öø-ƺƼ-ƿǄ-ʓʖ-ʯͰ-ͳͶ-ͷͻ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՠ-ֈႠ-ჅჇჍა-ჺჽ-ჿᎠ-Ᏽᏸ-ᏽᲀ-ᲊᲐ-ᲺᲽ-Ჿᴀ-ᴫᵫ-ᵷᵹ-ᶚḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℴℹℼ-ℿⅅ-ⅉⅎⅠ-ⅿↃ-ↄⒶ-ⓩⰀ-ⱻⱾ-ⳤⳫ-ⳮⳲ-ⳳⴀ-ⴥⴧⴭꙀ-ꙭꚀ-ꚛꜢ-ꝯꝱ-ꞇꞋ-ꞎꞐ-ꟜꟵ-ꟶꟺꬰ-ꭚꭠ-ꭨꭰ-ꮿﬀ-ﬆﬓ-ﬗＡ-Ｚａ-ｚ𐐀-𐑏𐒰-𐓓𐓘-𐓻𐕰-𐕺𐕼-𐖊𐖌-𐖒𐖔-𐖕𐖗-𐖡𐖣-𐖱𐖳-𐖹𐖻-𐖼𐲀-𐲲𐳀-𐳲𐵐-𐵥𐵰-𐶅𑢠-𑣟𖹀-𖹿𖺠-𖺸𖺻-𖻓𝐀-𝑔𝑖-𝒜𝒞-𝒟𝒢𝒥-𝒦𝒩-𝒬𝒮-𝒹𝒻𝒽-𝓃𝓅-𝔅𝔇-𝔊𝔍-𝔔𝔖-𝔜𝔞-𝔹𝔻-𝔾𝕀-𝕄𝕆𝕊-𝕐𝕒-𝚥𝚨-𝛀𝛂-𝛚𝛜-𝛺𝛼-𝜔𝜖-𝜴𝜶-𝝎𝝐-𝝮𝝰-𝞈𝞊-𝞨𝞪-𝟂𝟄-𝟋𝼀-𝼉𝼋-𝼞𝼥-𝼪𞤀-𞥃🄰-🅉🅐-🅩🅰-🆉]')
          then 'ς' else 'σ' end;
        texto := overlay(texto placing sigma from pos for 1);
      end if;
    end loop;
  end if;
  texto := translate(texto, 'ABCDEFGHIJKLMNOPQRSTUVWXYZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽƁƂƄƆƇƉƊƋƎƏƐƑƓƔƖƗƘƜƝƟƠƢƤƦƧƩƬƮƯƱƲƳƵƷƸƼǄǅǇǈǊǋǍǏǑǓǕǗǙǛǞǠǢǤǦǨǪǬǮǱǲǴǶǷǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȠȢȤȦȨȪȬȮȰȲȺȻȽȾɁɃɄɅɆɈɊɌɎͰͲͶͿΆΈΉΊΌΎΏΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫϏϘϚϜϞϠϢϤϦϨϪϬϮϴϷϹϺϽϾϿЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӀӁӃӅӇӉӋӍӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖႠႡႢႣႤႥႦႧႨႩႪႫႬႭႮႯႰႱႲႳႴႵႶႷႸႹႺႻႼႽႾႿჀჁჂჃჄჅჇჍᎠᎡᎢᎣᎤᎥᎦᎧᎨᎩᎪᎫᎬᎭᎮᎯᎰᎱᎲᎳᎴᎵᎶᎷᎸᎹᎺᎻᎼᎽᎾᎿᏀᏁᏂᏃᏄᏅᏆᏇᏈᏉᏊᏋᏌᏍᏎᏏᏐᏑᏒᏓᏔᏕᏖᏗᏘᏙᏚᏛᏜᏝᏞᏟᏠᏡᏢᏣᏤᏥᏦᏧᏨᏩᏪᏫᏬᏭᏮᏯᏰᏱᏲᏳᏴᏵᲉᲐᲑᲒᲓᲔᲕᲖᲗᲘᲙᲚᲛᲜᲝᲞᲟᲠᲡᲢᲣᲤᲥᲦᲧᲨᲩᲪᲫᲬᲭᲮᲯᲰᲱᲲᲳᲴᲵᲶᲷᲸᲹᲺᲽᲾᲿḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔẞẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾈᾉᾊᾋᾌᾍᾎᾏᾘᾙᾚᾛᾜᾝᾞᾟᾨᾩᾪᾫᾬᾭᾮᾯᾸᾹᾺΆᾼῈΈῊΉῌῘῙῚΊῨῩῪΎῬῸΌῺΏῼΩKÅℲⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯↃⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⰀⰁⰂⰃⰄⰅⰆⰇⰈⰉⰊⰋⰌⰍⰎⰏⰐⰑⰒⰓⰔⰕⰖⰗⰘⰙⰚⰛⰜⰝⰞⰟⰠⰡⰢⰣⰤⰥⰦⰧⰨⰩⰪⰫⰬⰭⰮⰯⱠⱢⱣⱤⱧⱩⱫⱭⱮⱯⱰⱲⱵⱾⱿⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝽꝾꞀꞂꞄꞆꞋꞍꞐꞒꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞪꞫꞬꞭꞮꞰꞱꞲꞳꞴꞶꞸꞺꞼꞾꟀꟂꟄꟅꟆꟇꟉꟋꟌ꟎Ꟑ꟒꟔ꟖꟘꟚꟜꟵＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇𐐈𐐉𐐊𐐋𐐌𐐍𐐎𐐏𐐐𐐑𐐒𐐓𐐔𐐕𐐖𐐗𐐘𐐙𐐚𐐛𐐜𐐝𐐞𐐟𐐠𐐡𐐢𐐣𐐤𐐥𐐦𐐧𐒰𐒱𐒲𐒳𐒴𐒵𐒶𐒷𐒸𐒹𐒺𐒻𐒼𐒽𐒾𐒿𐓀𐓁𐓂𐓃𐓄𐓅𐓆𐓇𐓈𐓉𐓊𐓋𐓌𐓍𐓎𐓏𐓐𐓑𐓒𐓓𐕰𐕱𐕲𐕳𐕴𐕵𐕶𐕷𐕸𐕹𐕺𐕼𐕽𐕾𐕿𐖀𐖁𐖂𐖃𐖄𐖅𐖆𐖇𐖈𐖉𐖊𐖌𐖍𐖎𐖏𐖐𐖑𐖒𐖔𐖕𐲀𐲁𐲂𐲃𐲄𐲅𐲆𐲇𐲈𐲉𐲊𐲋𐲌𐲍𐲎𐲏𐲐𐲑𐲒𐲓𐲔𐲕𐲖𐲗𐲘𐲙𐲚𐲛𐲜𐲝𐲞𐲟𐲠𐲡𐲢𐲣𐲤𐲥𐲦𐲧𐲨𐲩𐲪𐲫𐲬𐲭𐲮𐲯𐲰𐲱𐲲𐵐𐵑𐵒𐵓𐵔𐵕𐵖𐵗𐵘𐵙𐵚𐵛𐵜𐵝𐵞𐵟𐵠𐵡𐵢𐵣𐵤𐵥𑢠𑢡𑢢𑢣𑢤𑢥𑢦𑢧𑢨𑢩𑢪𑢫𑢬𑢭𑢮𑢯𑢰𑢱𑢲𑢳𑢴𑢵𑢶𑢷𑢸𑢹𑢺𑢻𑢼𑢽𑢾𑢿𖹀𖹁𖹂𖹃𖹄𖹅𖹆𖹇𖹈𖹉𖹊𖹋𖹌𖹍𖹎𖹏𖹐𖹑𖹒𖹓𖹔𖹕𖹖𖹗𖹘𖹙𖹚𖹛𖹜𖹝𖹞𖹟𖺠𖺡𖺢𖺣𖺤𖺥𖺦𖺧𖺨𖺩𖺪𖺫𖺬𖺭𖺮𖺯𖺰𖺱𖺲𖺳𖺴𖺵𖺶𖺷𖺸𞤀𞤁𞤂𞤃𞤄𞤅𞤆𞤇𞤈𞤉𞤊𞤋𞤌𞤍𞤎𞤏𞤐𞤑𞤒𞤓𞤔𞤕𞤖𞤗𞤘𞤙𞤚𞤛𞤜𞤝𞤞𞤟𞤠𞤡', 'abcdefghijklmnopqrstuvwxyzàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžɓƃƅɔƈɖɗƌǝəɛƒɠɣɩɨƙɯɲɵơƣƥʀƨʃƭʈưʊʋƴƶʒƹƽǆǆǉǉǌǌǎǐǒǔǖǘǚǜǟǡǣǥǧǩǫǭǯǳǳǵƕƿǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟƞȣȥȧȩȫȭȯȱȳⱥȼƚⱦɂƀʉʌɇɉɋɍɏͱͳͷϳάέήίόύώαβγδεζηθικλμνξοπρστυφχψωϊϋϗϙϛϝϟϡϣϥϧϩϫϭϯθϸϲϻͻͼͽѐёђѓєѕіїјљњћќѝўџабвгдежзийклмнопрстуфхцчшщъыьэюяѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӏӂӄӆӈӊӌӎӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥⴧⴭꭰꭱꭲꭳꭴꭵꭶꭷꭸꭹꭺꭻꭼꭽꭾꭿꮀꮁꮂꮃꮄꮅꮆꮇꮈꮉꮊꮋꮌꮍꮎꮏꮐꮑꮒꮓꮔꮕꮖꮗꮘꮙꮚꮛꮜꮝꮞꮟꮠꮡꮢꮣꮤꮥꮦꮧꮨꮩꮪꮫꮬꮭꮮꮯꮰꮱꮲꮳꮴꮵꮶꮷꮸꮹꮺꮻꮼꮽꮾꮿᏸᏹᏺᏻᏼᏽᲊაბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰჱჲჳჴჵჶჷჸჹჺჽჾჿḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕßạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧᾀᾁᾂᾃᾄᾅᾆᾇᾐᾑᾒᾓᾔᾕᾖᾗᾠᾡᾢᾣᾤᾥᾦᾧᾰᾱὰάᾳὲέὴήῃῐῑὶίῠῡὺύῥὸόὼώῳωkåⅎⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⰰⰱⰲⰳⰴⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱟⱡɫᵽɽⱨⱪⱬɑɱɐɒⱳⱶȿɀⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳬⳮⳳꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝺꝼᵹꝿꞁꞃꞅꞇꞌɥꞑꞓꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩɦɜɡɬɪʞʇʝꭓꞵꞷꞹꞻꞽꞿꟁꟃꞔʂᶎꟈꟊɤꟍ꟏ꟑꟓꟕꟗꟙꟛƛꟶａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱𐐲𐐳𐐴𐐵𐐶𐐷𐐸𐐹𐐺𐐻𐐼𐐽𐐾𐐿𐑀𐑁𐑂𐑃𐑄𐑅𐑆𐑇𐑈𐑉𐑊𐑋𐑌𐑍𐑎𐑏𐓘𐓙𐓚𐓛𐓜𐓝𐓞𐓟𐓠𐓡𐓢𐓣𐓤𐓥𐓦𐓧𐓨𐓩𐓪𐓫𐓬𐓭𐓮𐓯𐓰𐓱𐓲𐓳𐓴𐓵𐓶𐓷𐓸𐓹𐓺𐓻𐖗𐖘𐖙𐖚𐖛𐖜𐖝𐖞𐖟𐖠𐖡𐖣𐖤𐖥𐖦𐖧𐖨𐖩𐖪𐖫𐖬𐖭𐖮𐖯𐖰𐖱𐖳𐖴𐖵𐖶𐖷𐖸𐖹𐖻𐖼𐳀𐳁𐳂𐳃𐳄𐳅𐳆𐳇𐳈𐳉𐳊𐳋𐳌𐳍𐳎𐳏𐳐𐳑𐳒𐳓𐳔𐳕𐳖𐳗𐳘𐳙𐳚𐳛𐳜𐳝𐳞𐳟𐳠𐳡𐳢𐳣𐳤𐳥𐳦𐳧𐳨𐳩𐳪𐳫𐳬𐳭𐳮𐳯𐳰𐳱𐳲𐵰𐵱𐵲𐵳𐵴𐵵𐵶𐵷𐵸𐵹𐵺𐵻𐵼𐵽𐵾𐵿𐶀𐶁𐶂𐶃𐶄𐶅𑣀𑣁𑣂𑣃𑣄𑣅𑣆𑣇𑣈𑣉𑣊𑣋𑣌𑣍𑣎𑣏𑣐𑣑𑣒𑣓𑣔𑣕𑣖𑣗𑣘𑣙𑣚𑣛𑣜𑣝𑣞𑣟𖹠𖹡𖹢𖹣𖹤𖹥𖹦𖹧𖹨𖹩𖹪𖹫𖹬𖹭𖹮𖹯𖹰𖹱𖹲𖹳𖹴𖹵𖹶𖹷𖹸𖹹𖹺𖹻𖹼𖹽𖹾𖹿𖺻𖺼𖺽𖺾𖺿𖻀𖻁𖻂𖻃𖻄𖻅𖻆𖻇𖻈𖻉𖻊𖻋𖻌𖻍𖻎𖻏𖻐𖻑𖻒𖻓𞤢𞤣𞤤𞤥𞤦𞤧𞤨𞤩𞤪𞤫𞤬𞤭𞤮𞤯𞤰𞤱𞤲𞤳𞤴𞤵𞤶𞤷𞤸𞤹𞤺𞤻𞤼𞤽𞤾𞤿𞥀𞥁𞥂𞥃');
  texto := regexp_replace(texto collate "C", '[^0-9A-Za-zª²-³µ¹-º¼-¾À-ÖØ-öø-ˁˆ-ˑˠ-ˤˬˮͰ-ʹͶ-ͷͺ-ͽͿΆΈ-ΊΌΎ-ΡΣ-ϵϷ-ҁҊ-ԯԱ-Ֆՙՠ-ֈא-תׯ-ײؠ-ي٠-٩ٮ-ٯٱ-ۓەۥ-ۦۮ-ۼۿܐܒ-ܯݍ-ޥޱ߀-ߪߴ-ߵߺࠀ-ࠕࠚࠤࠨࡀ-ࡘࡠ-ࡪࡰ-ࢇࢉ-࢏ࢠ-ࣉऄ-हऽॐक़-ॡ०-९ॱ-ঀঅ-ঌএ-ঐও-নপ-রলশ-হঽৎড়-ঢ়য়-ৡ০-ৱ৴-৹ৼਅ-ਊਏ-ਐਓ-ਨਪ-ਰਲ-ਲ਼ਵ-ਸ਼ਸ-ਹਖ਼-ੜਫ਼੦-੯ੲ-ੴઅ-ઍએ-ઑઓ-નપ-રલ-ળવ-હઽૐૠ-ૡ૦-૯ૹଅ-ଌଏ-ଐଓ-ନପ-ରଲ-ଳଵ-ହଽଡ଼-ଢ଼ୟ-ୡ୦-୯ୱ-୷ஃஅ-ஊஎ-ஐஒ-கங-சஜஞ-டண-தந-பம-ஹௐ௦-௲అ-ఌఎ-ఐఒ-నప-హఽౘ-ౚ౜-ౝౠ-ౡ౦-౯౸-౾ಀಅ-ಌಎ-ಐಒ-ನಪ-ಳವ-ಹಽ೜-ೞೠ-ೡ೦-೯ೱ-ೲഄ-ഌഎ-ഐഒ-ഺഽൎൔ-ൖ൘-ൡ൦-൸ൺ-ൿඅ-ඖක-නඳ-රලව-ෆ෦-෯ก-ะา-ำเ-ๆ๐-๙ກ-ຂຄຆ-ຊຌ-ຣລວ-ະາ-ຳຽເ-ໄໆ໐-໙ໜ-ໟༀ༠-༳ཀ-ཇཉ-ཬྈ-ྌက-ဪဿ-၉ၐ-ၕၚ-ၝၡၥ-ၦၮ-ၰၵ-ႁႎ႐-႙Ⴀ-ჅჇჍა-ჺჼ-ቈቊ-ቍቐ-ቖቘቚ-ቝበ-ኈኊ-ኍነ-ኰኲ-ኵኸ-ኾዀዂ-ዅወ-ዖዘ-ጐጒ-ጕጘ-ፚ፩-፼ᎀ-ᎏᎠ-Ᏽᏸ-ᏽᐁ-ᙬᙯ-ᙿᚁ-ᚚᚠ-ᛪᛮ-ᛸᜀ-ᜑᜟ-ᜱᝀ-ᝑᝠ-ᝬᝮ-ᝰក-ឳៗៜ០-៩៰-៹᠐-᠙ᠠ-ᡸᢀ-ᢄᢇ-ᢨᢪᢰ-ᣵᤀ-ᤞ᥆-ᥭᥰ-ᥴᦀ-ᦫᦰ-ᧉ᧐-᧚ᨀ-ᨖᨠ-ᩔ᪀-᪉᪐-᪙ᪧᬅ-ᬳᭅ-ᭌ᭐-᭙ᮃ-ᮠᮮ-ᯥᰀ-ᰣ᱀-᱉ᱍ-ᱽᲀ-ᲊᲐ-ᲺᲽ-Ჿᳩ-ᳬᳮ-ᳳᳵ-ᳶᳺᴀ-ᶿḀ-ἕἘ-Ἕἠ-ὅὈ-Ὅὐ-ὗὙὛὝὟ-ώᾀ-ᾴᾶ-ᾼιῂ-ῄῆ-ῌῐ-ΐῖ-Ίῠ-Ῥῲ-ῴῶ-ῼ⁰-ⁱ⁴-⁹ⁿ-₉ₐ-ₜℂℇℊ-ℓℕℙ-ℝℤΩℨK-ℭℯ-ℹℼ-ℿⅅ-ⅉⅎ⅐-↉①-⒛⓪-⓿❶-➓Ⰰ-ⳤⳫ-ⳮⳲ-ⳳ⳽ⴀ-ⴥⴧⴭⴰ-ⵧⵯⶀ-ⶖⶠ-ⶦⶨ-ⶮⶰ-ⶶⶸ-ⶾⷀ-ⷆⷈ-ⷎⷐ-ⷖⷘ-ⷞⸯ々-〇〡-〩〱-〵〸-〼ぁ-ゖゝ-ゟァ-ヺー-ヿㄅ-ㄯㄱ-ㆎ㆒-㆕ㆠ-ㆿㇰ-ㇿ㈠-㈩㉈-㉏㉑-㉟㊀-㊉㊱-㊿㐀-䶿一-ꒌꓐ-ꓽꔀ-ꘌꘐ-ꘫꙀ-ꙮꙿ-ꚝꚠ-ꛯꜗ-ꜟꜢ-ꞈꞋ-Ƛ꟱-ꠁꠃ-ꠅꠇ-ꠊꠌ-ꠢ꠰-꠵ꡀ-ꡳꢂ-ꢳ꣐-꣙ꣲ-ꣷꣻꣽ-ꣾ꤀-ꤥꤰ-ꥆꥠ-ꥼꦄ-ꦲꧏ-꧙ꧠ-ꧤꧦ-ꧾꨀ-ꨨꩀ-ꩂꩄ-ꩋ꩐-꩙ꩠ-ꩶꩺꩾ-ꪯꪱꪵ-ꪶꪹ-ꪽꫀꫂꫛ-ꫝꫠ-ꫪꫲ-ꫴꬁ-ꬆꬉ-ꬎꬑ-ꬖꬠ-ꬦꬨ-ꬮꬰ-ꭚꭜ-ꭩꭰ-ꯢ꯰-꯹가-힣ힰ-ퟆퟋ-ퟻ豈-舘並-龎ﬀ-ﬆﬓ-ﬗיִײַ-ﬨשׁ-זּטּ-לּמּנּ-סּףּ-פּצּ-ﮱﯓ-ﴽﵐ-ﶏﶒ-ﷇﷰ-ﷻﹰ-ﹴﹶ-ﻼ０-９Ａ-Ｚａ-ｚｦ-ﾾￂ-ￇￊ-ￏￒ-ￗￚ-ￜ𐀀-𐀋𐀍-𐀦𐀨-𐀺𐀼-𐀽𐀿-𐁍𐁐-𐁝𐂀-𐃺𐄇-𐄳𐅀-𐅸𐆊-𐆋𐊀-𐊜𐊠-𐋐𐋡-𐋻𐌀-𐌣𐌭-𐍊𐍐-𐍵𐎀-𐎝𐎠-𐏃𐏈-𐏏𐏑-𐏕𐐀-𐒝𐒠-𐒩𐒰-𐓓𐓘-𐓻𐔀-𐔧𐔰-𐕣𐕰-𐕺𐕼-𐖊𐖌-𐖒𐖔-𐖕𐖗-𐖡𐖣-𐖱𐖳-𐖹𐖻-𐖼𐗀-𐗳𐘀-𐜶𐝀-𐝕𐝠-𐝧𐞀-𐞅𐞇-𐞰𐞲-𐞺𐠀-𐠅𐠈𐠊-𐠵𐠷-𐠸𐠼𐠿-𐡕𐡘-𐡶𐡹-𐢞𐢧-𐢯𐣠-𐣲𐣴-𐣵𐣻-𐤛𐤠-𐤹𐥀-𐥙𐦀-𐦷𐦼-𐧏𐧒-𐨀𐨐-𐨓𐨕-𐨗𐨙-𐨵𐩀-𐩈𐩠-𐩾𐪀-𐪟𐫀-𐫇𐫉-𐫤𐫫-𐫯𐬀-𐬵𐭀-𐭕𐭘-𐭲𐭸-𐮑𐮩-𐮯𐰀-𐱈𐲀-𐲲𐳀-𐳲𐳺-𐴣𐴰-𐴹𐵀-𐵥𐵯-𐶅𐹠-𐹾𐺀-𐺩𐺰-𐺱𐻂-𐻇𐼀-𐼧𐼰-𐽅𐽑-𐽔𐽰-𐾁𐾰-𐿋𐿠-𐿶𑀃-𑀷𑁒-𑁯𑁱-𑁲𑁵𑂃-𑂯𑃐-𑃨𑃰-𑃹𑄃-𑄦𑄶-𑄿𑅄𑅇𑅐-𑅲𑅶𑆃-𑆲𑇁-𑇄𑇐-𑇚𑇜𑇡-𑇴𑈀-𑈑𑈓-𑈫𑈿-𑉀𑊀-𑊆𑊈𑊊-𑊍𑊏-𑊝𑊟-𑊨𑊰-𑋞𑋰-𑋹𑌅-𑌌𑌏-𑌐𑌓-𑌨𑌪-𑌰𑌲-𑌳𑌵-𑌹𑌽𑍐𑍝-𑍡𑎀-𑎉𑎋𑎎𑎐-𑎵𑎷𑏑𑏓𑐀-𑐴𑑇-𑑊𑑐-𑑙𑑟-𑑡𑒀-𑒯𑓄-𑓅𑓇𑓐-𑓙𑖀-𑖮𑗘-𑗛𑘀-𑘯𑙄𑙐-𑙙𑚀-𑚪𑚸𑛀-𑛉𑛐-𑛣𑜀-𑜚𑜰-𑜻𑝀-𑝆𑠀-𑠫𑢠-𑣲𑣿-𑤆𑤉𑤌-𑤓𑤕-𑤖𑤘-𑤯𑤿𑥁𑥐-𑥙𑦠-𑦧𑦪-𑧐𑧡𑧣𑨀𑨋-𑨲𑨺𑩐𑩜-𑪉𑪝𑪰-𑫸𑯀-𑯠𑯰-𑯹𑰀-𑰈𑰊-𑰮𑱀𑱐-𑱬𑱲-𑲏𑴀-𑴆𑴈-𑴉𑴋-𑴰𑵆𑵐-𑵙𑵠-𑵥𑵧-𑵨𑵪-𑶉𑶘𑶠-𑶩𑶰-𑷛𑷠-𑷩𑻠-𑻲𑼂𑼄-𑼐𑼒-𑼳𑽐-𑽙𑾰𑿀-𑿔𒀀-𒎙𒐀-𒑮𒒀-𒕃𒾐-𒿰𓀀-𓐯𓑁-𓑆𓑠-𔏺𔐀-𔙆𖄀-𖄝𖄰-𖄹𖠀-𖨸𖩀-𖩞𖩠-𖩩𖩰-𖪾𖫀-𖫉𖫐-𖫭𖬀-𖬯𖭀-𖭃𖭐-𖭙𖭛-𖭡𖭣-𖭷𖭽-𖮏𖵀-𖵬𖵰-𖵹𖹀-𖺖𖺠-𖺸𖺻-𖻓𖼀-𖽊𖽐𖾓-𖾟𖿠-𖿡𖿣𖿲-𖿶𗀀-𘳕𘳿-𘴞𘶀-𘷲𚿰-𚿳𚿵-𚿻𚿽-𚿾𛀀-𛄢𛄲𛅐-𛅒𛅕𛅤-𛅧𛅰-𛋻𛰀-𛱪𛱰-𛱼𛲀-𛲈𛲐-𛲙𜳰-𜳹𝋀-𝋓𝋠-𝋳𝍠-𝍸𝐀-𝑔𝑖-𝒜𝒞-𝒟𝒢𝒥-𝒦𝒩-𝒬𝒮-𝒹𝒻𝒽-𝓃𝓅-𝔅𝔇-𝔊𝔍-𝔔𝔖-𝔜𝔞-𝔹𝔻-𝔾𝕀-𝕄𝕆𝕊-𝕐𝕒-𝚥𝚨-𝛀𝛂-𝛚𝛜-𝛺𝛼-𝜔𝜖-𝜴𝜶-𝝎𝝐-𝝮𝝰-𝞈𝞊-𝞨𝞪-𝟂𝟄-𝟋𝟎-𝟿𝼀-𝼞𝼥-𝼪𞀰-𞁭𞄀-𞄬𞄷-𞄽𞅀-𞅉𞅎𞊐-𞊭𞋀-𞋫𞋰-𞋹𞓐-𞓫𞓰-𞓹𞗐-𞗭𞗰-𞗺𞛀-𞛞𞛠-𞛢𞛤-𞛥𞛧-𞛭𞛰-𞛴𞛾-𞛿𞟠-𞟦𞟨-𞟫𞟭-𞟮𞟰-𞟾𞠀-𞣄𞣇-𞣏𞤀-𞥃𞥋𞥐-𞥙𞱱-𞲫𞲭-𞲯𞲱-𞲴𞴁-𞴭𞴯-𞴽𞸀-𞸃𞸅-𞸟𞸡-𞸢𞸤𞸧𞸩-𞸲𞸴-𞸷𞸹𞸻𞹂𞹇𞹉𞹋𞹍-𞹏𞹑-𞹒𞹔𞹗𞹙𞹛𞹝𞹟𞹡-𞹢𞹤𞹧-𞹪𞹬-𞹲𞹴-𞹷𞹹-𞹼𞹾𞺀-𞺉𞺋-𞺛𞺡-𞺣𞺥-𞺩𞺫-𞺻🄀-🄌🯰-🯹𠀀-𪛟𪜀-𫠝𫠠-𬺭𬺰-𮯠𮯰-𮹝丽-𪘀𰀀-𱍊𱍐-𳑹]+', ' ', 'g');
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
  texto := translate(valor, 'abcdefghijklmnopqrstuvwxyzµàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿāăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĳĵķĺļľŀłńņňŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżžſƀƃƅƈƌƒƕƙƚƛƞơƣƥƨƭưƴƶƹƽƿǅǆǈǉǋǌǎǐǒǔǖǘǚǜǝǟǡǣǥǧǩǫǭǯǲǳǵǹǻǽǿȁȃȅȇȉȋȍȏȑȓȕȗșțȝȟȣȥȧȩȫȭȯȱȳȼȿɀɂɇɉɋɍɏɐɑɒɓɔɖɗəɛɜɠɡɣɤɥɦɨɩɪɫɬɯɱɲɵɽʀʂʃʇʈʉʊʋʌʒʝʞͅͱͳͷͻͼͽάέήίαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώϐϑϕϖϗϙϛϝϟϡϣϥϧϩϫϭϯϰϱϲϳϵϸϻабвгдежзийклмнопрстуфхцчшщъыьэюяѐёђѓєѕіїјљњћќѝўџѡѣѥѧѩѫѭѯѱѳѵѷѹѻѽѿҁҋҍҏґғҕҗҙқҝҟҡңҥҧҩҫҭүұҳҵҷҹһҽҿӂӄӆӈӊӌӎӏӑӓӕӗәӛӝӟӡӣӥӧөӫӭӯӱӳӵӷӹӻӽӿԁԃԅԇԉԋԍԏԑԓԕԗԙԛԝԟԡԣԥԧԩԫԭԯաբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆაბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰჱჲჳჴჵჶჷჸჹჺჽჾჿᏸᏹᏺᏻᏼᏽᲀᲁᲂᲃᲄᲅᲆᲇᲈᲊᵹᵽᶎḁḃḅḇḉḋḍḏḑḓḕḗḙḛḝḟḡḣḥḧḩḫḭḯḱḳḵḷḹḻḽḿṁṃṅṇṉṋṍṏṑṓṕṗṙṛṝṟṡṣṥṧṩṫṭṯṱṳṵṷṹṻṽṿẁẃẅẇẉẋẍẏẑẓẕẛạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹỻỽỿἀἁἂἃἄἅἆἇἐἑἒἓἔἕἠἡἢἣἤἥἦἧἰἱἲἳἴἵἶἷὀὁὂὃὄὅὑὓὕὗὠὡὢὣὤὥὦὧὰάὲέὴήὶίὸόὺύὼώᾰᾱιῐῑῠῡῥⅎⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻⅼⅽⅾⅿↄⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩⰰⰱⰲⰳⰴⰵⰶⰷⰸⰹⰺⰻⰼⰽⰾⰿⱀⱁⱂⱃⱄⱅⱆⱇⱈⱉⱊⱋⱌⱍⱎⱏⱐⱑⱒⱓⱔⱕⱖⱗⱘⱙⱚⱛⱜⱝⱞⱟⱡⱥⱦⱨⱪⱬⱳⱶⲁⲃⲅⲇⲉⲋⲍⲏⲑⲓⲕⲗⲙⲛⲝⲟⲡⲣⲥⲧⲩⲫⲭⲯⲱⲳⲵⲷⲹⲻⲽⲿⳁⳃⳅⳇⳉⳋⳍⳏⳑⳓⳕⳗⳙⳛⳝⳟⳡⳣⳬⳮⳳⴀⴁⴂⴃⴄⴅⴆⴇⴈⴉⴊⴋⴌⴍⴎⴏⴐⴑⴒⴓⴔⴕⴖⴗⴘⴙⴚⴛⴜⴝⴞⴟⴠⴡⴢⴣⴤⴥⴧⴭꙁꙃꙅꙇꙉꙋꙍꙏꙑꙓꙕꙗꙙꙛꙝꙟꙡꙣꙥꙧꙩꙫꙭꚁꚃꚅꚇꚉꚋꚍꚏꚑꚓꚕꚗꚙꚛꜣꜥꜧꜩꜫꜭꜯꜳꜵꜷꜹꜻꜽꜿꝁꝃꝅꝇꝉꝋꝍꝏꝑꝓꝕꝗꝙꝛꝝꝟꝡꝣꝥꝧꝩꝫꝭꝯꝺꝼꝿꞁꞃꞅꞇꞌꞑꞓꞔꞗꞙꞛꞝꞟꞡꞣꞥꞧꞩꞵꞷꞹꞻꞽꞿꟁꟃꟈꟊꟍ꟏ꟑꟓꟕꟗꟙꟛꟶꭓꭰꭱꭲꭳꭴꭵꭶꭷꭸꭹꭺꭻꭼꭽꭾꭿꮀꮁꮂꮃꮄꮅꮆꮇꮈꮉꮊꮋꮌꮍꮎꮏꮐꮑꮒꮓꮔꮕꮖꮗꮘꮙꮚꮛꮜꮝꮞꮟꮠꮡꮢꮣꮤꮥꮦꮧꮨꮩꮪꮫꮬꮭꮮꮯꮰꮱꮲꮳꮴꮵꮶꮷꮸꮹꮺꮻꮼꮽꮾꮿａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ𐐨𐐩𐐪𐐫𐐬𐐭𐐮𐐯𐐰𐐱𐐲𐐳𐐴𐐵𐐶𐐷𐐸𐐹𐐺𐐻𐐼𐐽𐐾𐐿𐑀𐑁𐑂𐑃𐑄𐑅𐑆𐑇𐑈𐑉𐑊𐑋𐑌𐑍𐑎𐑏𐓘𐓙𐓚𐓛𐓜𐓝𐓞𐓟𐓠𐓡𐓢𐓣𐓤𐓥𐓦𐓧𐓨𐓩𐓪𐓫𐓬𐓭𐓮𐓯𐓰𐓱𐓲𐓳𐓴𐓵𐓶𐓷𐓸𐓹𐓺𐓻𐖗𐖘𐖙𐖚𐖛𐖜𐖝𐖞𐖟𐖠𐖡𐖣𐖤𐖥𐖦𐖧𐖨𐖩𐖪𐖫𐖬𐖭𐖮𐖯𐖰𐖱𐖳𐖴𐖵𐖶𐖷𐖸𐖹𐖻𐖼𐳀𐳁𐳂𐳃𐳄𐳅𐳆𐳇𐳈𐳉𐳊𐳋𐳌𐳍𐳎𐳏𐳐𐳑𐳒𐳓𐳔𐳕𐳖𐳗𐳘𐳙𐳚𐳛𐳜𐳝𐳞𐳟𐳠𐳡𐳢𐳣𐳤𐳥𐳦𐳧𐳨𐳩𐳪𐳫𐳬𐳭𐳮𐳯𐳰𐳱𐳲𐵰𐵱𐵲𐵳𐵴𐵵𐵶𐵷𐵸𐵹𐵺𐵻𐵼𐵽𐵾𐵿𐶀𐶁𐶂𐶃𐶄𐶅𑣀𑣁𑣂𑣃𑣄𑣅𑣆𑣇𑣈𑣉𑣊𑣋𑣌𑣍𑣎𑣏𑣐𑣑𑣒𑣓𑣔𑣕𑣖𑣗𑣘𑣙𑣚𑣛𑣜𑣝𑣞𑣟𖹠𖹡𖹢𖹣𖹤𖹥𖹦𖹧𖹨𖹩𖹪𖹫𖹬𖹭𖹮𖹯𖹰𖹱𖹲𖹳𖹴𖹵𖹶𖹷𖹸𖹹𖹺𖹻𖹼𖹽𖹾𖹿𖺻𖺼𖺽𖺾𖺿𖻀𖻁𖻂𖻃𖻄𖻅𖻆𖻇𖻈𖻉𖻊𖻋𖻌𖻍𖻎𖻏𖻐𖻑𖻒𖻓𞤢𞤣𞤤𞤥𞤦𞤧𞤨𞤩𞤪𞤫𞤬𞤭𞤮𞤯𞤰𞤱𞤲𞤳𞤴𞤵𞤶𞤷𞤸𞤹𞤺𞤻𞤼𞤽𞤾𞤿𞥀𞥁𞥂𞥃', 'ABCDEFGHIJKLMNOPQRSTUVWXYZΜÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞŸĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮIĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŹŻŽSɃƂƄƇƋƑǶƘȽꟜȠƠƢƤƧƬƯƳƵƸƼǷǄǄǇǇǊǊǍǏǑǓǕǗǙǛƎǞǠǢǤǦǨǪǬǮǱǱǴǸǺǼǾȀȂȄȆȈȊȌȎȐȒȔȖȘȚȜȞȢȤȦȨȪȬȮȰȲȻⱾⱿɁɆɈɊɌɎⱯⱭⱰƁƆƉƊƏƐꞫƓꞬƔꟋꞍꞪƗƖꞮⱢꞭƜⱮƝƟⱤƦꟅƩꞱƮɄƱƲɅƷꞲꞰΙͰͲͶϽϾϿΆΈΉΊΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΣΤΥΦΧΨΩΪΫΌΎΏΒΘΦΠϏϘϚϜϞϠϢϤϦϨϪϬϮΚΡϹͿΕϷϺАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѠѢѤѦѨѪѬѮѰѲѴѶѸѺѼѾҀҊҌҎҐҒҔҖҘҚҜҞҠҢҤҦҨҪҬҮҰҲҴҶҸҺҼҾӁӃӅӇӉӋӍӀӐӒӔӖӘӚӜӞӠӢӤӦӨӪӬӮӰӲӴӶӸӺӼӾԀԂԄԆԈԊԌԎԐԒԔԖԘԚԜԞԠԢԤԦԨԪԬԮԱԲԳԴԵԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՒՓՔՕՖᲐᲑᲒᲓᲔᲕᲖᲗᲘᲙᲚᲛᲜᲝᲞᲟᲠᲡᲢᲣᲤᲥᲦᲧᲨᲩᲪᲫᲬᲭᲮᲯᲰᲱᲲᲳᲴᲵᲶᲷᲸᲹᲺᲽᲾᲿᏰᏱᏲᏳᏴᏵВДОСТТЪѢꙊᲉꝽⱣꟆḀḂḄḆḈḊḌḎḐḒḔḖḘḚḜḞḠḢḤḦḨḪḬḮḰḲḴḶḸḺḼḾṀṂṄṆṈṊṌṎṐṒṔṖṘṚṜṞṠṢṤṦṨṪṬṮṰṲṴṶṸṺṼṾẀẂẄẆẈẊẌẎẐẒẔṠẠẢẤẦẨẪẬẮẰẲẴẶẸẺẼẾỀỂỄỆỈỊỌỎỐỒỔỖỘỚỜỞỠỢỤỦỨỪỬỮỰỲỴỶỸỺỼỾἈἉἊἋἌἍἎἏἘἙἚἛἜἝἨἩἪἫἬἭἮἯἸἹἺἻἼἽἾἿὈὉὊὋὌὍὙὛὝὟὨὩὪὫὬὭὮὯᾺΆῈΈῊΉῚΊῸΌῪΎῺΏᾸᾹΙῘῙῨῩῬℲⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅬⅭⅮⅯↃⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⰀⰁⰂⰃⰄⰅⰆⰇⰈⰉⰊⰋⰌⰍⰎⰏⰐⰑⰒⰓⰔⰕⰖⰗⰘⰙⰚⰛⰜⰝⰞⰟⰠⰡⰢⰣⰤⰥⰦⰧⰨⰩⰪⰫⰬⰭⰮⰯⱠȺȾⱧⱩⱫⱲⱵⲀⲂⲄⲆⲈⲊⲌⲎⲐⲒⲔⲖⲘⲚⲜⲞⲠⲢⲤⲦⲨⲪⲬⲮⲰⲲⲴⲶⲸⲺⲼⲾⳀⳂⳄⳆⳈⳊⳌⳎⳐⳒⳔⳖⳘⳚⳜⳞⳠⳢⳫⳭⳲႠႡႢႣႤႥႦႧႨႩႪႫႬႭႮႯႰႱႲႳႴႵႶႷႸႹႺႻႼႽႾႿჀჁჂჃჄჅჇჍꙀꙂꙄꙆꙈꙊꙌꙎꙐꙒꙔꙖꙘꙚꙜꙞꙠꙢꙤꙦꙨꙪꙬꚀꚂꚄꚆꚈꚊꚌꚎꚐꚒꚔꚖꚘꚚꜢꜤꜦꜨꜪꜬꜮꜲꜴꜶꜸꜺꜼꜾꝀꝂꝄꝆꝈꝊꝌꝎꝐꝒꝔꝖꝘꝚꝜꝞꝠꝢꝤꝦꝨꝪꝬꝮꝹꝻꝾꞀꞂꞄꞆꞋꞐꞒꟄꞖꞘꞚꞜꞞꞠꞢꞤꞦꞨꞴꞶꞸꞺꞼꞾꟀꟂꟇꟉꟌ꟎Ꟑ꟒꟔ꟖꟘꟚꟵꞳᎠᎡᎢᎣᎤᎥᎦᎧᎨᎩᎪᎫᎬᎭᎮᎯᎰᎱᎲᎳᎴᎵᎶᎷᎸᎹᎺᎻᎼᎽᎾᎿᏀᏁᏂᏃᏄᏅᏆᏇᏈᏉᏊᏋᏌᏍᏎᏏᏐᏑᏒᏓᏔᏕᏖᏗᏘᏙᏚᏛᏜᏝᏞᏟᏠᏡᏢᏣᏤᏥᏦᏧᏨᏩᏪᏫᏬᏭᏮᏯＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ𐐀𐐁𐐂𐐃𐐄𐐅𐐆𐐇𐐈𐐉𐐊𐐋𐐌𐐍𐐎𐐏𐐐𐐑𐐒𐐓𐐔𐐕𐐖𐐗𐐘𐐙𐐚𐐛𐐜𐐝𐐞𐐟𐐠𐐡𐐢𐐣𐐤𐐥𐐦𐐧𐒰𐒱𐒲𐒳𐒴𐒵𐒶𐒷𐒸𐒹𐒺𐒻𐒼𐒽𐒾𐒿𐓀𐓁𐓂𐓃𐓄𐓅𐓆𐓇𐓈𐓉𐓊𐓋𐓌𐓍𐓎𐓏𐓐𐓑𐓒𐓓𐕰𐕱𐕲𐕳𐕴𐕵𐕶𐕷𐕸𐕹𐕺𐕼𐕽𐕾𐕿𐖀𐖁𐖂𐖃𐖄𐖅𐖆𐖇𐖈𐖉𐖊𐖌𐖍𐖎𐖏𐖐𐖑𐖒𐖔𐖕𐲀𐲁𐲂𐲃𐲄𐲅𐲆𐲇𐲈𐲉𐲊𐲋𐲌𐲍𐲎𐲏𐲐𐲑𐲒𐲓𐲔𐲕𐲖𐲗𐲘𐲙𐲚𐲛𐲜𐲝𐲞𐲟𐲠𐲡𐲢𐲣𐲤𐲥𐲦𐲧𐲨𐲩𐲪𐲫𐲬𐲭𐲮𐲯𐲰𐲱𐲲𐵐𐵑𐵒𐵓𐵔𐵕𐵖𐵗𐵘𐵙𐵚𐵛𐵜𐵝𐵞𐵟𐵠𐵡𐵢𐵣𐵤𐵥𑢠𑢡𑢢𑢣𑢤𑢥𑢦𑢧𑢨𑢩𑢪𑢫𑢬𑢭𑢮𑢯𑢰𑢱𑢲𑢳𑢴𑢵𑢶𑢷𑢸𑢹𑢺𑢻𑢼𑢽𑢾𑢿𖹀𖹁𖹂𖹃𖹄𖹅𖹆𖹇𖹈𖹉𖹊𖹋𖹌𖹍𖹎𖹏𖹐𖹑𖹒𖹓𖹔𖹕𖹖𖹗𖹘𖹙𖹚𖹛𖹜𖹝𖹞𖹟𖺠𖺡𖺢𖺣𖺤𖺥𖺦𖺧𖺨𖺩𖺪𖺫𖺬𖺭𖺮𖺯𖺰𖺱𖺲𖺳𖺴𖺵𖺶𖺷𖺸𞤀𞤁𞤂𞤃𞤄𞤅𞤆𞤇𞤈𞤉𞤊𞤋𞤌𞤍𞤎𞤏𞤐𞤑𞤒𞤓𞤔𞤕𞤖𞤗𞤘𞤙𞤚𞤛𞤜𞤝𞤞𞤟𞤠𞤡');
  texto := replace(texto, 'ß', 'SS');
  texto := replace(texto, 'ŉ', 'ʼN');
  texto := replace(texto, 'ǰ', 'J̌');
  texto := replace(texto, 'ΐ', 'Ϊ́');
  texto := replace(texto, 'ΰ', 'Ϋ́');
  texto := replace(texto, 'և', 'ԵՒ');
  texto := replace(texto, 'ẖ', 'H̱');
  texto := replace(texto, 'ẗ', 'T̈');
  texto := replace(texto, 'ẘ', 'W̊');
  texto := replace(texto, 'ẙ', 'Y̊');
  texto := replace(texto, 'ẚ', 'Aʾ');
  texto := replace(texto, 'ὐ', 'Υ̓');
  texto := replace(texto, 'ὒ', 'Υ̓̀');
  texto := replace(texto, 'ὔ', 'Υ̓́');
  texto := replace(texto, 'ὖ', 'Υ̓͂');
  texto := replace(texto, 'ᾀ', 'ἈΙ');
  texto := replace(texto, 'ᾁ', 'ἉΙ');
  texto := replace(texto, 'ᾂ', 'ἊΙ');
  texto := replace(texto, 'ᾃ', 'ἋΙ');
  texto := replace(texto, 'ᾄ', 'ἌΙ');
  texto := replace(texto, 'ᾅ', 'ἍΙ');
  texto := replace(texto, 'ᾆ', 'ἎΙ');
  texto := replace(texto, 'ᾇ', 'ἏΙ');
  texto := replace(texto, 'ᾈ', 'ἈΙ');
  texto := replace(texto, 'ᾉ', 'ἉΙ');
  texto := replace(texto, 'ᾊ', 'ἊΙ');
  texto := replace(texto, 'ᾋ', 'ἋΙ');
  texto := replace(texto, 'ᾌ', 'ἌΙ');
  texto := replace(texto, 'ᾍ', 'ἍΙ');
  texto := replace(texto, 'ᾎ', 'ἎΙ');
  texto := replace(texto, 'ᾏ', 'ἏΙ');
  texto := replace(texto, 'ᾐ', 'ἨΙ');
  texto := replace(texto, 'ᾑ', 'ἩΙ');
  texto := replace(texto, 'ᾒ', 'ἪΙ');
  texto := replace(texto, 'ᾓ', 'ἫΙ');
  texto := replace(texto, 'ᾔ', 'ἬΙ');
  texto := replace(texto, 'ᾕ', 'ἭΙ');
  texto := replace(texto, 'ᾖ', 'ἮΙ');
  texto := replace(texto, 'ᾗ', 'ἯΙ');
  texto := replace(texto, 'ᾘ', 'ἨΙ');
  texto := replace(texto, 'ᾙ', 'ἩΙ');
  texto := replace(texto, 'ᾚ', 'ἪΙ');
  texto := replace(texto, 'ᾛ', 'ἫΙ');
  texto := replace(texto, 'ᾜ', 'ἬΙ');
  texto := replace(texto, 'ᾝ', 'ἭΙ');
  texto := replace(texto, 'ᾞ', 'ἮΙ');
  texto := replace(texto, 'ᾟ', 'ἯΙ');
  texto := replace(texto, 'ᾠ', 'ὨΙ');
  texto := replace(texto, 'ᾡ', 'ὩΙ');
  texto := replace(texto, 'ᾢ', 'ὪΙ');
  texto := replace(texto, 'ᾣ', 'ὫΙ');
  texto := replace(texto, 'ᾤ', 'ὬΙ');
  texto := replace(texto, 'ᾥ', 'ὭΙ');
  texto := replace(texto, 'ᾦ', 'ὮΙ');
  texto := replace(texto, 'ᾧ', 'ὯΙ');
  texto := replace(texto, 'ᾨ', 'ὨΙ');
  texto := replace(texto, 'ᾩ', 'ὩΙ');
  texto := replace(texto, 'ᾪ', 'ὪΙ');
  texto := replace(texto, 'ᾫ', 'ὫΙ');
  texto := replace(texto, 'ᾬ', 'ὬΙ');
  texto := replace(texto, 'ᾭ', 'ὭΙ');
  texto := replace(texto, 'ᾮ', 'ὮΙ');
  texto := replace(texto, 'ᾯ', 'ὯΙ');
  texto := replace(texto, 'ᾲ', 'ᾺΙ');
  texto := replace(texto, 'ᾳ', 'ΑΙ');
  texto := replace(texto, 'ᾴ', 'ΆΙ');
  texto := replace(texto, 'ᾶ', 'Α͂');
  texto := replace(texto, 'ᾷ', 'Α͂Ι');
  texto := replace(texto, 'ᾼ', 'ΑΙ');
  texto := replace(texto, 'ῂ', 'ῊΙ');
  texto := replace(texto, 'ῃ', 'ΗΙ');
  texto := replace(texto, 'ῄ', 'ΉΙ');
  texto := replace(texto, 'ῆ', 'Η͂');
  texto := replace(texto, 'ῇ', 'Η͂Ι');
  texto := replace(texto, 'ῌ', 'ΗΙ');
  texto := replace(texto, 'ῒ', 'Ϊ̀');
  texto := replace(texto, 'ΐ', 'Ϊ́');
  texto := replace(texto, 'ῖ', 'Ι͂');
  texto := replace(texto, 'ῗ', 'Ϊ͂');
  texto := replace(texto, 'ῢ', 'Ϋ̀');
  texto := replace(texto, 'ΰ', 'Ϋ́');
  texto := replace(texto, 'ῤ', 'Ρ̓');
  texto := replace(texto, 'ῦ', 'Υ͂');
  texto := replace(texto, 'ῧ', 'Ϋ͂');
  texto := replace(texto, 'ῲ', 'ῺΙ');
  texto := replace(texto, 'ῳ', 'ΩΙ');
  texto := replace(texto, 'ῴ', 'ΏΙ');
  texto := replace(texto, 'ῶ', 'Ω͂');
  texto := replace(texto, 'ῷ', 'Ω͂Ι');
  texto := replace(texto, 'ῼ', 'ΩΙ');
  texto := replace(texto, 'ﬀ', 'FF');
  texto := replace(texto, 'ﬁ', 'FI');
  texto := replace(texto, 'ﬂ', 'FL');
  texto := replace(texto, 'ﬃ', 'FFI');
  texto := replace(texto, 'ﬄ', 'FFL');
  texto := replace(texto, 'ﬅ', 'ST');
  texto := replace(texto, 'ﬆ', 'ST');
  texto := replace(texto, 'ﬓ', 'ՄՆ');
  texto := replace(texto, 'ﬔ', 'ՄԵ');
  texto := replace(texto, 'ﬕ', 'ՄԻ');
  texto := replace(texto, 'ﬖ', 'ՎՆ');
  texto := replace(texto, 'ﬗ', 'ՄԽ');
  return texto;
end;
$fn$;
-- END UNICODE

-- trim ECMAScript: não é equivalente a btrim(texto) para tabs/NBSP/BOM.
create or replace function public.matching_trim_v1(valor text)
returns text language sql immutable strict parallel safe set search_path = pg_catalog
as $$ select btrim(valor, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'); $$;

create or replace function public.matching_termos_v1(valor text)
returns text[] language sql immutable parallel safe set search_path = pg_catalog
as $$
  select coalesce(array_agg(termo order by primeira), '{}'::text[])
  from (
    select termo collate "C" as termo, min(ord) primeira
    from unnest(string_to_array(public.matching_normalizar_v1(coalesce(valor, '')), ' ')) with ordinality t(termo, ord)
    where termo <> '' and termo <> all(array['de','da','do','das','dos','para','com','em','e','a','o','as','os','um','uma','uns','umas','no','na','nos','nas','por','ao','aos','ou'])
    group by termo collate "C"
  ) termos;
$$;

-- Tipos text/text[] tornam a concatenação independente de locale/data/timezone.
create or replace function public.matching_tokens_v1(titulo text, objeto text, tags text[], modalidade text)
returns text[] language sql immutable parallel safe set search_path = pg_catalog
as $$
  select coalesce(array_agg(token order by primeira), '{}'::text[])
  from (
    select token collate "C" as token, min(ord) primeira
    from unnest(string_to_array(public.matching_normalizar_v1(
      coalesce(titulo,'') || ' ' || coalesce(objeto,'') || ' ' ||
      coalesce(array_to_string(tags, ' '),'') || ' ' || coalesce(modalidade,'')), ' ')) with ordinality t(token,ord)
    where token <> '' group by token collate "C"
  ) tokens;
$$;

alter table public.oportunidades_editais
  add column if not exists matching_tokens text[] generated always as
    (public.matching_tokens_v1(titulo, objeto, tags, modalidade)) stored,
  add column if not exists busca_documento text generated always as
    (titulo || E'\n' || orgao || E'\n' || modalidade || E'\n' || cidade || E'\n' || objeto) stored;

create or replace function public.matching_preparar_v1(palavras text[], segmento text, uf text)
returns jsonb language sql immutable parallel safe set search_path = pg_catalog
as $$
  with entradas as (
    select ord, public.matching_trim_v1(palavra) original,
      public.matching_normalizar_v1(palavra) normalizada,
      public.matching_termos_v1(palavra) termos
    from unnest(palavras) with ordinality t(palavra,ord)
  ), unicas as (
    select distinct on (normalizada collate "C") * from entradas
    where cardinality(termos) > 0 order by normalizada collate "C", ord
  )
  select jsonb_build_object(
    'palavras', coalesce((select jsonb_agg(jsonb_build_object('original',original,'termos',termos) order by ord) from unicas), '[]'::jsonb),
    'segmento', public.matching_termos_v1(segmento),
    'uf', public.matching_upper_v1(public.matching_trim_v1(coalesce(uf,'')))
  );
$$;

-- Mesmo matcher para lista e detalhe. Apenas operações em dados preparados.
create or replace function public.matching_calcular_v1(perfil jsonb, tokens text[], uf text)
returns jsonb language plpgsql immutable parallel safe set search_path = pg_catalog
as $$
declare
  palavras text[];
  segmento text[];
  total_palavras integer := jsonb_array_length(perfil->'palavras');
  total_segmento integer := jsonb_array_length(perfil->'segmento');
  mesma_uf boolean := (perfil->>'uf') ~ '^[A-Z]{2}$' and
    perfil->>'uf' = public.matching_upper_v1(public.matching_trim_v1(coalesce(uf,'')));
  pontos double precision := 0;
  score integer;
  motivos text[];
begin
  select coalesce(array_agg(p->>'original' order by ord), '{}'::text[]) into palavras
  from jsonb_array_elements(perfil->'palavras') with ordinality t(p,ord)
  where coalesce(tokens,'{}') @> array(select jsonb_array_elements_text(p->'termos'));
  select coalesce(array_agg(termo order by ord), '{}'::text[]) into segmento
  from jsonb_array_elements_text(perfil->'segmento') with ordinality t(termo,ord)
  where termo = any(coalesce(tokens,'{}'));
  -- Mesma sequência double precision e arredondamento positivo da referência JS.
  if total_palavras > 0 then pontos := (65::double precision * cardinality(palavras)) / total_palavras; end if;
  if total_segmento > 0 then
    pontos := pontos + ((case when total_palavras > 0 then 25 else 90 end)::double precision * cardinality(segmento)) / total_segmento;
  end if;
  pontos := pontos + (case when mesma_uf then 10 else 0 end);
  score := greatest(0, least(100, floor(pontos)::integer +
    case when pontos - floor(pontos) >= 0.5 then 1 else 0 end));
  motivos := array[
    case when total_palavras > 0 then cardinality(palavras) || ' de ' || total_palavras || ' palavras-chave encontradas.'
      else 'Sem palavras-chave úteis: o segmento representa até 90 pontos.' end,
    cardinality(segmento) || ' de ' || total_segmento || ' termos do segmento encontrados.'
  ];
  if cardinality(palavras) > 0 then motivos := array_append(motivos, 'Palavras encontradas: ' || array_to_string(palavras, ', ') || '.'); end if;
  if mesma_uf then motivos := array_append(motivos, 'Oportunidade na mesma UF do perfil (+10 pontos).'); end if;
  return jsonb_build_object('score',score,'nivel',case when score >= 70 then 'alta' when score >= 40 then 'media' else 'baixa' end,
    'palavrasEncontradas',palavras,'termosSegmentoEncontrados',segmento,'mesmaUf',mesma_uf,'motivos',motivos);
end;
$$;


-- Score scalar: mesma aritmética do matcher, sem construir JSON/motivos por linha.
create or replace function public.matching_preparar_score_v1(perfil jsonb)
returns table (palavras text[], segmento text[], uf text, uf_valida boolean)
language sql immutable parallel safe set search_path = pg_catalog
as $$
  select coalesce((select array_agg(array_to_string(array(select jsonb_array_elements_text(p->'termos')), chr(31)) order by ord)
    from jsonb_array_elements(perfil->'palavras') with ordinality t(p,ord)), '{}'::text[]),
    coalesce(array(select jsonb_array_elements_text(perfil->'segmento')), '{}'::text[]),
    perfil->>'uf', (perfil->>'uf') ~ '^[A-Z]{2}$';
$$;

create or replace function public.matching_score_v1(palavras text[], segmento text[], uf_perfil text, uf_valida boolean, tokens text[], uf text)
returns integer language plpgsql immutable parallel safe set search_path = pg_catalog
as $$
declare
  grupo text; termo text; encontrou boolean;
  total_palavras integer := cardinality(coalesce(palavras,'{}'));
  total_segmento integer := cardinality(coalesce(segmento,'{}'));
  qtd_palavras integer := 0; qtd_segmento integer := 0;
  mesma_uf boolean := coalesce(uf_valida,false) and
    uf_perfil = public.matching_upper_v1(public.matching_trim_v1(coalesce(uf,'')));
  pontos double precision := 0;
begin
  -- Termos e grupos vêm prontos do perfil; FOREACH evita SPI/JSON unnest por linha.
  foreach grupo in array coalesce(palavras,'{}') loop
    encontrou := true;
    foreach termo in array string_to_array(grupo, chr(31)) loop
      if not (termo = any(coalesce(tokens,'{}'))) then encontrou := false; exit; end if;
    end loop;
    if encontrou then qtd_palavras := qtd_palavras + 1; end if;
  end loop;
  foreach termo in array coalesce(segmento,'{}') loop
    if termo = any(coalesce(tokens,'{}')) then qtd_segmento := qtd_segmento + 1; end if;
  end loop;
  if total_palavras > 0 then pontos := (65::double precision * qtd_palavras) / total_palavras; end if;
  if total_segmento > 0 then
    pontos := pontos + ((case when total_palavras > 0 then 25 else 90 end)::double precision * qtd_segmento) / total_segmento;
  end if;
  pontos := pontos + (case when mesma_uf then 10 else 0 end);
  return greatest(0, least(100, floor(pontos)::integer +
    case when pontos - floor(pontos) >= 0.5 then 1 else 0 end));
end;
$$;

create or replace function public.matching_perfil_autorizado_v1(p_perfil_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare preparado jsonb;
begin
  if auth.uid() is null then raise exception 'Não autorizado' using errcode = '42501'; end if;
  if p_perfil_id is null then return null; end if;
  select public.matching_preparar_v1(p.palavras_chave,p.segmento,p.uf) into preparado
  from public.perfis_empresa p where p.id = p_perfil_id and p.usuario_id = auth.uid();
  if preparado is null then raise exception 'Perfil indisponível' using errcode = '42501'; end if;
  return preparado;
end;
$$;

-- Datas tipadas inválidas são rejeitadas pelo Postgres; infinity equivale a JS inválido.
create or replace function public.matching_prazo_v1(prazo timestamptz, abertura date)
returns timestamptz language sql immutable parallel safe set search_path=pg_catalog
as $$ select coalesce(case when isfinite(prazo) then prazo end,
  case when isfinite(abertura) then abertura::timestamp at time zone 'UTC' end); $$;

create or replace function public.listar_oportunidades_paginadas_v1(
  p_perfil_id uuid default null, p_busca text default null, p_status text default null,
  p_uf text default null, p_aderencia text default null, p_ordenacao text default 'recomendadas',
  p_pagina integer default 1
)
returns table (oportunidade jsonb, match jsonb, favorito boolean)
language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare
  perfil jsonb := public.matching_perfil_autorizado_v1(p_perfil_id);
  modo text := coalesce(p_ordenacao,'recomendadas');
  termo text := nullif(public.matching_trim_v1(p_busca),'');
  padrao text;
  uf_filtro text := nullif(upper(public.matching_trim_v1(p_uf)), '');
  nivel text := case when perfil is null then null else nullif(p_aderencia,'') end;
  palavras_score text[] := '{}';
  segmento_score text[] := '{}';
  uf_score text;
  uf_score_valida boolean := false;
begin
  if modo not in ('recomendadas','mais_novas','maior_aderencia','prazo_proximo') then modo := 'recomendadas'; end if;
  if perfil is null and modo = 'maior_aderencia' then modo := 'recomendadas'; end if;
  if nullif(p_status,'') is not null and p_status not in ('aberta','em_analise','encerrada') then raise exception 'Status inválido'; end if;
  if nivel is not null and nivel not in ('alta','media','baixa') then raise exception 'Aderência inválida'; end if;
  if perfil is not null then
    select palavras,segmento,uf,uf_valida into palavras_score,segmento_score,uf_score,uf_score_valida
    from public.matching_preparar_score_v1(perfil);
  end if;
  -- Escape de barra primeiro; % e _ são literais. Sem SQL dinâmico.
  padrao := '%' || replace(replace(replace(termo, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
  -- Sem perfil, não materializar a base inteira nem avaliar matcher.
  if perfil is null then
    return query
    with pagina as materialized (
      select o.* from public.oportunidades_editais o
      where (nullif(p_status,'') is null or o.status = p_status)
        and (uf_filtro is null or o.uf = uf_filtro)
        and (termo is null or (o.busca_documento ilike padrao escape E'\\' and
          (o.titulo ilike padrao escape E'\\' or o.orgao ilike padrao escape E'\\' or
           o.modalidade ilike padrao escape E'\\' or o.cidade ilike padrao escape E'\\' or o.objeto ilike padrao escape E'\\')))
      order by
        case when modo='recomendadas' then case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end
          else case when o.status='encerrada' then 1 else 0 end end,
        case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end asc nulls last,
        case when isfinite(o.data_publicacao) then o.data_publicacao end desc nulls last, o.id
      limit 21 offset ((greatest(coalesce(p_pagina,1),1)::bigint - 1) * 20)
    )
    select jsonb_build_object('id',o.id,'codigo',o.codigo,'origem',o.origem,'tipo',o.tipo,
      'titulo',o.titulo,'orgao',o.orgao,'modalidade',o.modalidade,'uf',o.uf,'cidade',o.cidade,
      'objeto',o.objeto,'valorEstimado',o.valor_estimado,'dataPublicacao',case when isfinite(o.data_publicacao) then o.data_publicacao end,
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,'status',o.status,'tags',o.tags), null::jsonb,
      exists(select 1 from public.oportunidades_favoritos f where f.usuario_id=auth.uid() and f.oportunidade_id=o.id)
    from pagina o order by
      case when modo='recomendadas' then case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end
        else case when o.status='encerrada' then 1 else 0 end end,
      case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end asc nulls last,
      case when isfinite(o.data_publicacao) then o.data_publicacao end desc nulls last, o.id;
    return;
  end if;
  return query
  with elegiveis as materialized (
    select o.id, o.status, case when isfinite(o.data_publicacao) then o.data_publicacao end data_publicacao,
      case when modo='prazo_proximo' then public.matching_prazo_v1(o.participacao_prazo_limite,o.data_abertura) end prazo,
      case o.status when 'aberta' then 0 when 'em_analise' then 1 else 2 end prioridade,
      case when o.status = 'encerrada' then 1 else 0 end encerrada,
      case when nivel is not null or modo in ('recomendadas','maior_aderencia')
        then public.matching_score_v1(palavras_score,segmento_score,uf_score,uf_score_valida,o.matching_tokens,o.uf) end score
    from public.oportunidades_editais o
    where (nullif(p_status,'') is null or o.status = p_status)
      and (uf_filtro is null or o.uf = uf_filtro)
      and (termo is null or (o.busca_documento ilike padrao escape E'\\' and
        (o.titulo ilike padrao escape E'\\' or o.orgao ilike padrao escape E'\\' or
         o.modalidade ilike padrao escape E'\\' or o.cidade ilike padrao escape E'\\' or o.objeto ilike padrao escape E'\\')))
  ), pagina as materialized (
    select e.*, row_number() over (order by
      case when modo = 'recomendadas' then e.prioridade end,
      case when modo in ('mais_novas','prazo_proximo') then e.encerrada end,
      case when modo in ('recomendadas','maior_aderencia') then e.score end desc nulls last,
      case when modo = 'maior_aderencia' then e.encerrada end,
      case when modo = 'prazo_proximo' then e.prazo end asc nulls last,
      e.data_publicacao desc nulls last, e.id) posicao
    from elegiveis e
    where nivel is null or (case when e.score >= 70 then 'alta' when e.score >= 40 then 'media' else 'baixa' end) = nivel
    order by posicao
    limit 21 offset ((greatest(coalesce(p_pagina,1),1)::bigint - 1) * 20)
  )
  select jsonb_build_object('id',o.id,'codigo',o.codigo,'origem',o.origem,'tipo',o.tipo,
      'titulo',o.titulo,'orgao',o.orgao,'modalidade',o.modalidade,'uf',o.uf,'cidade',o.cidade,
      'objeto',o.objeto,'valorEstimado',o.valor_estimado,'dataPublicacao',case when isfinite(o.data_publicacao) then o.data_publicacao end,
      'dataAbertura',case when isfinite(o.data_abertura) then o.data_abertura end,'status',o.status,'tags',o.tags),
    case when perfil is null then null else public.matching_calcular_v1(perfil,o.matching_tokens,o.uf) end,
    exists(select 1 from public.oportunidades_favoritos f where f.usuario_id = auth.uid() and f.oportunidade_id = p.id)
  from pagina p join public.oportunidades_editais o on o.id = p.id
  order by p.posicao;
end;
$$;

create or replace function public.calcular_match_oportunidade_v1(p_perfil_id uuid, p_oportunidade_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare perfil jsonb := public.matching_perfil_autorizado_v1(p_perfil_id); resultado jsonb;
begin
  if perfil is null then return null; end if;
  select public.matching_calcular_v1(perfil, o.matching_tokens, o.uf) into resultado
  from public.oportunidades_editais o where o.id = p_oportunidade_id;
  return resultado;
end;
$$;

-- Índices existentes no repositório: status e data_abertura simples; PKs de ID/favoritos.
-- Sem índice de score: é variável por perfil.
-- pg_trgm pode estar instalado em public ou extensions; resolver opclass explicitamente.
do $$
declare esquema text;
begin
  select n.nspname into esquema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists oportunidades_busca_trgm_v1_idx on public.oportunidades_editais using gin (busca_documento %I.gin_trgm_ops)', esquema);
end; $$;
create index if not exists oportunidades_uf_v1_idx on public.oportunidades_editais (uf);
-- Ordenações simples e dashboard; planos da RPC devem ser medidos em homologação.
create index if not exists oportunidades_publicacao_v1_idx on public.oportunidades_editais
  ((case when status = 'encerrada' then 1 else 0 end), (case when isfinite(data_publicacao) then data_publicacao end) desc nulls last, id);

-- Helpers não leem dados privados; INVOKER exige EXECUTE nas dependências.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure assinatura, p.proname nome from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('matching_normalizar_v1','matching_upper_v1','matching_trim_v1','matching_termos_v1',
      'matching_tokens_v1','matching_prazo_v1','matching_preparar_v1','matching_calcular_v1','matching_score_v1','matching_preparar_score_v1','matching_perfil_autorizado_v1',
      'listar_oportunidades_paginadas_v1','calcular_match_oportunidade_v1')
  loop
    execute format('revoke all on function %s from public, anon', f.assinatura);
    execute format('grant execute on function %s to authenticated', f.assinatura);
    -- A ingestão existente precisa calcular colunas geradas; não ganha acesso às RPCs de usuário.
    if f.nome in ('matching_normalizar_v1','matching_tokens_v1') then
      execute format('grant execute on function %s to service_role', f.assinatura);
    end if;
  end loop;
end; $$;
commit;
