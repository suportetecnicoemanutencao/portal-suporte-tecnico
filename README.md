# Portal Suporte Técnico · Nebulize

App do Suporte Técnico: registro de atendimentos, guia passo a passo para as auxiliares, vínculo automático com o Bitrix24, confirmação das O.S. pelo webhook do Infraspeak, lembretes, dashboard e relatório mensal.

**Stack:** HTML/JS sem build (pasta `public/`) · Supabase (login, banco e notificações em tempo real) · Netlify (hospedagem + funções) · GitHub (código).

```
public/                 site (index.html, css, js)
netlify/functions/      bitrix-vincular · bitrix-monitor (a cada 5 min) · infraspeak-webhook · lembretes (agendada)
netlify/lib/            código comum das funções
supabase/schema.sql     tabelas, regras de acesso (RLS) e gatilhos
supabase/002_bitrix_automatico.sql   atualização: abertura automática e captura de dados do Bitrix
supabase/003_conversas.sql           atualização: aba Minhas conversas + avisos no Bitrix
supabase/004_cobrancas.sql           atualização: cobranças citadas no chat
scripts/                gerar-config (build) · criar-usuarios
```

## Quem vê o quê

| Perfil | Pode |
|---|---|
| Auxiliar (Katielen, Mayara) | registrar atendimentos, editar os próprios, ver os da equipe, receber lembretes |
| Administrador · Supervisor (Thalison) | tudo acima + editar qualquer atendimento, dashboard, relatório mensal, avisos de atendimentos parados |

## Passo a passo para colocar no ar

### 1. Supabase
1. Crie um projeto em https://supabase.com (região **South America (São Paulo)**).
2. **SQL Editor** → cole todo o conteúdo de `supabase/schema.sql` → **Run**.
3. **Authentication → Sign In / Providers → Email**: deixe Email ativo e **desligue "Allow new users to sign up"** (só quem você criar entra).
4. **Authentication → URL Configuration**: em *Site URL* coloque o endereço do Netlify (ex.: `https://portal-suporte-tecnico.netlify.app`).
5. **Project Settings → API**: copie *Project URL*, a chave *anon public* e a chave *service_role* (secreta).

### 2. Usuários
No seu computador, dentro da pasta do projeto:
```bash
npm install
SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_ROLE_KEY="..." SENHA_INICIAL="..." npm run usuarios
```
Cria Thalison (supervisor), Katielen e Mayara (auxiliares). Cada uma pode trocar a senha no botão **Senha** do portal.
Alternativa sem terminal: Supabase → Authentication → Users → *Add user* (marque *Auto confirm*); depois, na tabela `perfis`, ajuste `nome` e `papel`.

Usuário criado pelo painel entra como **auxiliar**. Para tornar o Thalison administrador do portal e supervisor da equipe, rode no SQL Editor:
```sql
update public.perfis set papel = 'supervisor', nome = 'Thalison' where email = 'manutencao@nebulize.com.br';
```

### 3. GitHub
Crie um repositório **privado** (ex.: `portal-suporte-tecnico`) e envie esta pasta:
```bash
git init && git add . && git commit -m "Portal Suporte Técnico"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/portal-suporte-tecnico.git
git push -u origin main
```
O `.gitignore` já impede enviar `.env` e `config.js`. **Nunca coloque chaves no código.**

### 4. Netlify
O projeto **portal-suporte-tecnico** já foi criado na sua conta (https://app.netlify.com/projects/portal-suporte-tecnico) com estas variáveis prontas: `BITRIX_WEBHOOK_URL`, `BITRIX_PORTAL_URL` e `INFRASPEAK_WEBHOOK_TOKEN`.

1. **Project configuration → Build & deploy → Link repository** → GitHub → escolha o repositório. O `netlify.toml` já configura build, pasta e funções.
2. **Project configuration → Environment variables** → adicione:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | chave anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role |

3. *Deploys → Trigger deploy*. Depois de cada mudança nas variáveis, faça novo deploy.
4. Endereço: https://portal-suporte-tecnico.netlify.app

### 5. Webhook do Infraspeak
No Infraspeak, cadastre o webhook para os eventos de **O.S. criada** e **O.S. concluída/fechada** apontando para:
```
https://SEU-SITE.netlify.app/api/infraspeak/webhook?token=SEU_INFRASPEAK_WEBHOOK_TOKEN
```
Abrir esse endereço no navegador deve responder `{"ok":true,...}`. Cada aviso recebido fica gravado na tabela `infraspeak_eventos`; o portal procura o nº da O.S. informado no atendimento e avisa a auxiliar (O.S. confirmada / O.S. fechada → fazer pós-atendimento).

## Automação com o Bitrix (atualização 002)
Rode `supabase/002_bitrix_automatico.sql` no SQL Editor (uma vez).

- **Abertura automática:** a função `bitrix-monitor` (a cada 5 min) acompanha as conversas novas do Canal Aberto. Quando a auxiliar se apresenta com *"Olá, tudo bem? Você está falando com o Suporte Técnico Nebulize, me chamo Katielen."* (também reconhece "meu nome é Katielen" ou "sou a Katielen, do Suporte Técnico"), o atendimento é aberto no portal para ela, já vinculado à conversa, e ela recebe uma notificação.
  O nome da saudação é comparado com `perfis.nome_bitrix` (por padrão, o primeiro nome do perfil).
- **Captura de dados:** ao vincular (ou clicar em *Atualizar do Bitrix*) e a cada 5 min nos atendimentos em aberto, o portal lê as mensagens da conversa e preenche os campos vazios: cliente, telefone, **CNPJ** (com dígito verificador), **nº de série** (padrão NBV… ou resposta ao pedido do nº de série), **nº da O.S.** ("ordem de serviço nº …"), e-mail, endereço e modelo. O que a auxiliar digitou nunca é sobrescrito; os campos capturados aparecem com a etiqueta *do Bitrix*.

## Minhas conversas (atualização 003)
Rode `supabase/003_conversas.sql` (já traz os IDs do Bitrix: Thalison 51, Katielen 8937, Mayara 14305).

A cada 5 min o `bitrix-monitor` lê as conversas abertas em que cada uma é a responsável no Bitrix e classifica:

| Grupo | Regra |
|---|---|
| Sem resposta há +4 h | última mensagem é do cliente e ele espera há mais de 4 h |
| Promessa pendente | sua última mensagem foi "só um momento", "vou verificar", "te retorno"… há mais de 1 h |
| Novas | conversa atribuída a você sem nenhuma resposta ainda |
| Chamado a atualizar | atendimento com O.S. em aberto e mais de 24 h sem falar com o cliente |
| Cliente aguardando | cliente escreveu há menos de 4 h |
| Em dia | o resto (inclui "ok", "obrigado" do cliente depois da sua resposta) |

**Avisos:** de segunda a sexta, 07:00–17:45, no sininho do portal e no sino do Bitrix (enviados pelo webhook, por isso chegam com alerta). O mesmo aviso repete a cada 3 h; "Nova" avisa uma vez. Resumo às 8h.
**✓ Respondido** tira a conversa dos alertas até chegar mensagem nova. Conversas com atendimento vinculado mostram o status do atendimento (Aguardando técnico, peça, cliente…) para trocar ali mesmo.

**Cobranças a fazer (004):** quando alguém escreve no chat "precisa ser cobrado", "cobrar o cliente/a visita/a peça", "gerar/enviar boleto", "faturar", "pagamento pendente"… a conversa entra em *Cobranças a fazer* com o trecho da mensagem e gera um aviso. "Cobrar o técnico" não conta. O botão **Cobrança feita** baixa a pendência até aparecer um novo pedido de cobrança. Substitui o "Monitor Bitrix" em Apps Script da Katielen (desative os acionadores dele para não receber aviso em dobro).

## Como funciona no dia a dia
1. **Registrar atendimento** antes de iniciar a conversa (canal, tipo, modelo; o nº do Bitrix pode vir depois).
2. Ao informar o **nº da conversa do Canal Aberto** (ex.: 30015) e clicar **Vincular**, a função `bitrix-vincular` consulta o Bitrix (`imopenlines.dialog.get`, `crm.activity.list`, `crm.lead/contact/company.get`) e grava cliente, telefone, link da conversa e link do CRM.
3. O guia (testes, chamado, orçamento, RMA, e-mails) usa os dados do atendimento aberto; testes marcados entram no texto do chamado.
4. **Lembretes** (função agendada, seg–sáb 8h e 16h de Brasília): atendimentos em aberto, parados há 3+ dias (vai também para o supervisor) e conversas já encerradas no Bitrix com atendimento aberto no portal. Aparecem no sininho em tempo real e como notificação do navegador.
5. **Dashboard e Relatório mensal** (supervisor): totais por tipo (aluguel, venda em garantia, venda fora de garantia), por auxiliar, status, modelo, tempo médio, satisfação; relatório para imprimir/PDF e planilha CSV.

## Segurança
- A URL do webhook do Bitrix dá acesso administrativo ao CRM: fica **só** na variável `BITRIX_WEBHOOK_URL` do Netlify. Como ela já foi compartilhada em conversa, recomendo gerar uma nova no Bitrix (Aplicativos → Webhooks) com apenas os escopos `crm`, `imopenlines`, `im`, `user` e atualizar a variável.
- A chave `service_role` só é usada nas funções do Netlify; o navegador usa a chave anon, limitada pelas regras RLS do banco.
