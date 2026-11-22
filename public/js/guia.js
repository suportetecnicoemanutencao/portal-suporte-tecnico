// Conteúdo técnico do guia (testes por modelo, vídeos, medições). Fonte: skill suporte-nebulize.
const V={ // vídeos oficiais
 instal400:['Instalação NB400/NB800','https://youtu.be/Xx3rM8o2I4Y'],
 config400:['Configuração NB400/NB800','https://youtu.be/dVPJP3PFBsM'],
 limpeza400:['Limpeza manual NB400/NB800','https://youtube.com/shorts/FMw5xdfreho'],
 transb:['Máquina transbordando','https://youtu.be/XWbpZ8Y8vVs'],
 semagua1:['Sem água (SEM AGUA) · parte 1','https://youtu.be/euXx-L0UtRs'],
 semagua2:['Sem água (SEM AGUA) · parte 2','https://youtu.be/vMwotZG5x0Q'],
 semnevoa:['Sem névoa com Nebulizando e Ventilando acesos','https://youtu.be/vV3_Ka-gxFk'],
 fraca:['Nebulizando sem força na saída da névoa','https://youtu.be/8MikCPcNtNo'],
 standby:['Painel só com LED Ligado/Standby','https://youtu.be/7KIvGFPsTXg'],
 apagado:['Painel totalmente apagado','https://youtu.be/86msTth8ko0'],
 botao:['Placa apitando e botão apertando sozinho','https://youtu.be/EsX9Yxi42is'],
 grava:['Não está gravando configuração','https://youtu.be/mb0nyO09Dzc'],
 cfg100s:['Configuração completa NB100S','https://youtube.com/shorts/68_PSaUgUEw'],
 cfg6c:['NB6C · ajuste de configuração','https://youtu.be/rijYrkR3jrg'],
 cfg6cav:['NB6C · configuração avançada','https://youtu.be/2aat3ympUqs'],
 ed120:['Montagem da bancada ED120','https://youtu.be/lX4uWgALndc'],
 nbi1:['Instalação NBi com 1 torre','https://youtu.be/yOmyHSWR2hk'],
 nbi2:['Instalação NBi com 2 torres','https://youtu.be/YMIuEsWSmbA'],
 filtro:['Como limpar o filtro duplo','https://youtu.be/w8ojg9ofr4M']
};
const GERAL=[
 'Equipamento ligado em tomada 220V exclusiva e aterrada, sem extensão, benjamim ou adaptador',
 'Disjuntor do circuito ligado (10 A exclusivo)',
 'Ponto de água aberto e com água na rede (ou reservatório externo abastecido)',
 'Filtro duplo instalado, na vertical e sem saturação (plissado lavado a cada 3 meses; carvão trocado a cada 9 meses)',
 'Registro de esvaziamento fechado (só abre em manutenção ou transporte)',
 'Mangueiras e tubulação de névoa sem dobras, barrigas ou vazamentos',
 'Cliente enviou vídeo do painel ligado'
];
const MODELS={
 nb400:{name:'NB400 / NB800',desc:'Linha automática · display 5 dígitos',syms:[
  {t:'Painel e display totalmente apagados',s:'crit',ask:['Há energia na tomada? Testar outro aparelho na mesma tomada','Chave geral (lado direito do painel) está ligada? Desligar a chave não apaga a programação','Disjuntor do circuito ligado'],next:'Com energia e chave ligada: fonte 12V ou PCI Controle. Abrir chamado.',vid:['apagado']},
  {t:'Máquina parada, só LED Ligado/Standby aceso',s:'warn',ask:['Conferir hora atual (MENU › rELoG) e dia de hoje (dIA H)','Conferir início e pausa (LIGAr / PAuSA): pode estar fora do horário','Conferir dias de funcionamento (FunC): dia de hoje com -L?','LED Ciclo de esterilização aceso? É normal: aguardar cerca de 40 min'],ok:'Pausa, dia desligado ou esterilização são normais, não é defeito.',next:'Programação e relógio corretos e máquina parada dentro do horário: PCI Controle. Abrir chamado.',vid:['standby','config400']},
  {t:'Não grava ou perde a configuração',s:'warn',ask:['Cada item foi confirmado com ENTER? ESC descarta','O menu sai sozinho após ~2 min sem tecla e descarta o que não foi gravado','A hora se perde depois de falta de energia (ERRO BATERIA)?'],next:'Hora sumindo: bateria 3V. Configuração confirmada e ainda se perde: PCI Controle. Abrir chamado.',vid:['grava']},
  {t:'LEDs acesos mas não ventila',s:'warn',ask:['Conferir ajuste de Ventilação (faixa 40–100%, padrão 80%)'],next:'Ventilação ajustada e sem ventilar: PCI Controle ou microventilador. Abrir chamado.',vid:['fraca']},
  {t:'LEDs acesos mas não nebuliza',s:'crit',ask:['Display mostra "d" + segundos? É a pausa do ciclo (normal); volta a nebulizar quando zerar','Conferir % Ciclo/Ratio: 0% não nebuliza (padrão 80%)','Conferir Intensidade de nebulização (padrão 80%)'],next:'Fora da pausa e ajustes corretos: fonte 48V, PCI Potência ou transdutor. Abrir chamado.',vid:['semnevoa']},
  {t:'Nebulização fraca',s:'warn',ask:['Conferir Intensidade, Ventilação e Ratio (padrão 80% / 80% / 80%)','Preventiva em dia? Cerâmicas com crosta: limpar com pincel de cerdas macias','Mangueiras sem dobras ou barrigas','Equipamento longe de porta, ar-condicionado, ventilador ou cortina de ar'],next:'Ajustes e limpeza OK e continua fraca: cerâmicas/transdutor. Abrir chamado.',vid:['fraca','limpeza400']},
  {t:'Alarme SEM AGUA (não enche)',s:'crit',ask:['Registro ou torneira de entrada aberto','Filtro de entrada sem saturação e na vertical','Há água e pressão na rede (0,5 a 7 bar)?'],ok:'A máquina trava e apita se não encher em 10 min.',next:'Água, registro e filtro OK: válvula de entrada, sensor de nível ou cabo Mike. Abrir chamado.',vid:['semagua1','semagua2','filtro']},
  {t:'Não para de encher / transbordando',s:'crit',ask:['Registro de escoamento manual (porta lateral) está fechado?','LED Enchendo está apagado e mesmo assim continua enchendo?'],next:'Registro fechado e enche com LED apagado: relé da PCI Potência. Abrir chamado.',vid:['transb']},
  {t:'Alarme SOBRE TEMP',s:'warn',ask:['Temperatura da água de entrada (máximo 30 °C)','Tubulação de água passa por forro, telhado ou perto de forno/compressor?'],next:'Água normal: sensor de temperatura (NTC). Abrir chamado.',vid:[]},
  {t:'Alarme ERRO DRENO',s:'warn',ask:['Sifão corrugado em desnível, sem barrigas ou voltas','Ponto de esgoto desobstruído; máquina pelo menos 15 cm acima do esgoto'],next:'Dreno livre e alarme continua: bomba de esvaziamento. Abrir chamado.',vid:[]},
  {t:'Alarme VAZAMENTO',s:'crit',ask:['Registro de escoamento manual fechado','Vazamento visível no reservatório, mangueiras ou conexões?'],next:'Sem vazamento aparente: sensor de nível. Abrir chamado.',vid:[]},
  {t:'Alarmes ERRO AQUECE, TEMPO AQUECE, ERRO TEMP ou SOBRET ESTER',s:'crit',ask:['Anotar o nome exato do alarme e pedir vídeo do display'],next:'Falha na esterilização (resistência, sensor ou PCI). Abrir chamado.',vid:[]},
  {t:'ERRO BATERIA / perde a hora',s:'info',ask:['Reprogramar rELoG (hora) e dIA H (dia)'],next:'Se voltar a perder a hora: bateria 3V. Abrir chamado.',vid:['config400']},
  {t:'Display mostra PREVENTIVA',s:'info',ask:['Explicar ao cliente que é aviso de manutenção preventiva, não defeito; a máquina continua funcionando'],next:'Agendar a preventiva.',vid:[]},
  {t:'Pingando nos furos de saída de névoa',s:'info',ask:['Tubulação de névoa tem caimento?','Saídas de névoa estão voltadas para baixo?'],next:'Corrigir tubulação ou ângulo das saídas na visita.',vid:[]},
  {t:'Placa apitando ou botões acionando sozinhos',s:'warn',ask:['Painel com umidade ou condensação?'],next:'Umidade/corrosão na PCI Controle. Abrir chamado.',vid:['botao']}
 ]},
 nbi:{name:'NB3i / NB6i / NB10i',desc:'Linha manual · knobs e LEDs (inclui NBST)',syms:[
  {t:'Equipamento não liga',s:'crit',ask:['Tomada com 220V: testar em outra tomada (sem extensão)','Disjuntor ligado'],next:'Com energia e sem ligar: DC Converter ou PCI. Abrir chamado.',vid:[]},
  {t:'LEDs piscando alternados (1×/s)',s:'warn',ask:['Ponto de água aberto e com pressão','Registro de esvaziamento fechado','Filtros plissado/carvão sem entupimento'],ok:'Falha de abastecimento após 7 min: bomba e válvula desligam e a máquina rearma sozinha quando o nível voltar.',next:'Os 3 itens OK e continua: válvula de entrada ou sensor de nível. Abrir chamado.',vid:['filtro']},
  {t:'LEDs piscando juntos (1×/s)',s:'info',ask:['Aguardar alguns minutos: está reabastecendo'],ok:'Comportamento normal.',next:'Se demorar muito, tratar como falha de abastecimento (LEDs alternados).',vid:[]},
  {t:'Knobs ou controle remoto não respondem',s:'info',ask:['Há Painel de Controle de Umidade na parede? Se sim, os ajustes são feitos pela tela dele (normal)','Sem o painel: trocar a bateria do controle remoto'],next:'Sem painel e com bateria nova: defeito no controle ou painel. Abrir chamado.',vid:[]},
  {t:'Painel de Controle de Umidade mostra "erro" e "sens"',s:'warn',ask:['Cabo e conexão do sensor de umidade encaixados'],ok:'Nessa condição o painel interrompe a nebulização por segurança.',next:'Reconectado e continua: cabo/sensor. Abrir chamado.',vid:[]},
  {t:'Nebuliza por muito pouco tempo',s:'info',ask:['Conferir knob de Ciclo: nível 1 = 15 s a cada 2 min; nível 8 = 1min45s a cada 2 min'],next:'Ciclo alto e tempo curto: cerâmicas ou fluxo de água. Abrir chamado.',vid:[]},
  {t:'Névoa fraca ou sem névoa',s:'warn',ask:['Knobs: vermelho = baixo, amarelo = médio, verde = alto (manuais antigos eram invertidos)','Tanque limpo e bem enxaguado (resíduo de sabão causa falha)','Mangueira da torre reta, sem curvas acumulando água'],next:'Ajustes e limpeza OK: cerâmicas. Abrir chamado.',vid:['nbi1','nbi2']},
  {t:'Painel ligado mas não aciona nebulização',s:'crit',ask:['LEDs ligados? Enviar vídeo do painel'],next:'Teste técnico: cooling fan 12V ou módulo de nebulização. Abrir chamado.',vid:[]},
  {t:'Névoa saindo pela ventilação',s:'warn',ask:['Confirmar por vídeo onde a névoa sai'],next:'Mist Blowing Fan 12V. Abrir chamado.',vid:[]},
  {t:'Vaza água pela ventilação',s:'warn',ask:['Limpar o tanque por dentro','Boia livre, sem estar presa'],next:'Sensor de nível/boia. Abrir chamado.',vid:[]},
  {t:'Não puxa água ou puxa pouco',s:'warn',ask:['Mangueiras sem obstrução','Limpar o filtro'],next:'Bomba, filtro ou válvula solenoide. Abrir chamado.',vid:['filtro']}
 ]},
 nb6c:{name:'NB6C',desc:'Linha automática · encoder rotativo',syms:[
  {t:'Display mostra ESPER',s:'info',ask:['Conferir hora, data e horários de funcionamento'],next:'Se perder a hora de novo: bateria 3V / PCI. Abrir chamado.',vid:['cfg6c']},
  {t:'Equipamento não liga',s:'crit',ask:['Tomada 220V e chave gangorra ligada'],next:'Fonte 24V ou PCI Controle. Abrir chamado.',vid:[]},
  {t:'Nebulizando fraco',s:'warn',ask:['Conferir intensidade de nebulização','Tanque limpo, sem crosta ou resíduo'],next:'Cerâmicas ou placa nebulizadora. Abrir chamado.',vid:['cfg6cav']},
  {t:'S.AGUA / S.AgUA no display',s:'warn',ask:['Com reservatório externo: encher, recolocar a tampa com a bomba e apertar MENU','Com ponto de água: registro aberto e filtro limpo'],next:'Fonte da bomba, bomba, válvula de entrada ou sensor de nível. Abrir chamado.',vid:['filtro']},
  {t:'ChEIO no display',s:'info',ask:['Esvaziar o reservatório externo de saída, recolocar a tampa e apertar MENU'],next:'Se repetir com reservatório vazio: chamado.',vid:[]},
  {t:'Erro L.Ou.Er (não esvazia)',s:'warn',ask:['Registro de esvaziamento fechado','Sifão sem barrigas'],next:'Válvula de saída. Abrir chamado.',vid:[]},
  {t:'Erro L.In.Er (não enche)',s:'warn',ask:['Água na rede, filtro limpo'],next:'Válvula de entrada ou bomba. Abrir chamado.',vid:[]},
  {t:'Erros Htr.Er, FAn.Er ou bot.Er',s:'crit',ask:['Anotar o código e enviar vídeo do display'],next:'Aquecimento, ventilador ou botão preso. Abrir chamado.',vid:[]},
  {t:'Nebulizando por pouco tempo',s:'info',ask:['Conferir parâmetros RATIO e CICLO'],next:'Configuração correta: PCI Controle. Abrir chamado.',vid:['cfg6c']},
  {t:'Vazando ou névoa voltando pelo ventilador',s:'crit',ask:['Enviar vídeo mostrando onde vaza ou por onde sai a névoa'],next:'Sensor de nível, válvula de saída ou microventilador. Abrir chamado.',vid:[]},
  {t:'Consultar histórico de erros',s:'info',ask:['Segurar MENU por 2 s › ErrOr › MENU. Índice 01 = erro mais recente (25 últimos)'],next:'Anotar os códigos no chamado.',vid:[]}
 ]},
 nb100s:{name:'NB100 / NB100S',desc:'Linha automática · tanque 5 L',syms:[
  {t:'Display mostra STAND',s:'info',ask:['Conferir hora, data e horários de funcionamento'],next:'Se perder a hora de novo: bateria 3V. Abrir chamado.',vid:['cfg100s']},
  {t:'Equipamento não liga',s:'crit',ask:['Tomada 220V e interruptor ON/OFF ligado'],next:'Fonte 48V. Abrir chamado.',vid:[]},
  {t:'Nebulizando fraco',s:'warn',ask:['Configuração de nebulização no mínimo 70%','Mangueira reta, sem curvas','Tanque limpo','Tela do ventilador limpa e ventilador girando'],next:'Cerâmicas ou bloco. Abrir chamado.',vid:['cfg100s']},
  {t:'Nebulizando por pouco tempo',s:'info',ask:['Conferir ciclo/ratio: configurar ciclo em 80%'],next:'Configuração correta: PCI de controle. Abrir chamado.',vid:['cfg100s']},
  {t:'S.AGUA no display',s:'warn',ask:['Água na rede, registro aberto, filtro limpo'],next:'Fonte da bomba, bomba, válvula de entrada ou sensor de nível. Abrir chamado.',vid:['filtro']},
  {t:'Nebulizando sem pausa',s:'crit',ask:['Enviar vídeo do display e da névoa'],next:'Bloco de cerâmicas em curto (provisório: baixar para 70%). Abrir chamado.',vid:[]},
  {t:'Vazando ou FAN / névoa voltando',s:'crit',ask:['Enviar vídeo mostrando o defeito'],next:'Sensor de nível, solenoide ou microventilador. Abrir chamado.',vid:[]}
 ]},
 outros:{name:'SU6M · GRD4B · ST2c/ST6c',desc:'Sem procedimento completo',syms:[
  {t:'Qualquer defeito',s:'warn',ask:['Aplicar a lista "Antes de tudo"','Pedir vídeo do painel e da instalação','SU6M: conferir botão Liga/Desliga e ajuste de ventilação (ciclos são fixos)'],next:'Procedimento específico pendente de manual. Repasse ao Supervisor antes de abrir chamado.',vid:[]}
 ]}
};
const SEVL={crit:'Crítico',warn:'Atenção',info:'Orientação'};
const SEVC={crit:'var(--crit)',warn:'var(--warn)',info:'var(--info)'};

const REF={
   nb400:[['Entrada L/N','CA','±220V'],['Fonte 12V','CC','±12V'],['Fonte 48V','CC','±48V'],['Bateria RTC','CC','>3,0V'],['Vias 13/14 ressonador (NB800 +15/16)','CC','±42V nebulizando'],['Vias 19/20 nível','Continuidade','Beep'],['Vias 21/22 ventilador','CC','±10V'],['Vias 11/12 válvula entrada','CA','±220V acionada'],['Vias 23/24 e 9/10 NTC','Ohms','varia com temperatura'],['Cabo Mike 2W','Continuidade','Beep']],
   nbi:[['Entrada 220V','CA','±220V'],['DC Converter saída','CC','±12V'],['Cooling Fan 12V','Teste','desconectar e testar nebulização'],['Atomizing Modules','Teste','reconectar um a um'],['Conector AKZ950','Continuidade','Beep']],
   nb6c:[['Chave gangorra L/N','CA','±220V'],['Fonte 24V','CC','±24V'],['Bateria RTC','CC','>3,0V'],['Pinos 1/2 nível','Continuidade','Beep'],['Pinos 3/4 cerâmicas','CC','±24V'],['Pinos 5/6 válvula entrada','CA','±220V'],['Pinos 7/8 válvula saída','CA','±220V'],['Pinos 13/14 microventilador','CC','±24V']],
   nb100s:[['Interruptor L/N','CA','±220V'],['Fonte 48V 350W (CN5)','CC','±48V'],['CN6/CN7 ressonador','CC','±48V'],['Bateria RTC','CC','>3,0V'],['Pinos nível 9/10 ou 14/15','Continuidade','Beep'],['Pinos 12/13 válvula entrada','CA','±220V'],['Ventilador +/–','CC','±12V']],
   outros:[]};
export { V, GERAL, MODELS, SEVL, SEVC, REF };
