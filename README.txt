MEU CRONOGRAMA ACADÊMICO — V20
LOGIN INDIVIDUAL, PRIVACIDADE E SINCRONIZAÇÃO

POR QUE FOI NECESSÁRIO ADICIONAR UM BACKEND
A versão anterior salvava dados no navegador. Isso era suficiente para testes,
mas não cria contas privadas reais nem sincroniza celular e computador.

Nesta versão foi adicionado Supabase Auth + banco Postgres com Row Level Security.

RECURSOS
- tela de login responsiva e visualmente renovada;
- criação de conta;
- login com e-mail e senha;
- confirmação de senha;
- mostrar/ocultar senha;
- sessão persistente;
- logout;
- dados vinculados ao UUID do usuário;
- cache local separado por usuário;
- sincronização do estado com a nuvem;
- funcionamento em desktop, tablet e celular.

PRIVACIDADE
O arquivo supabase-setup.sql cria a tabela user_app_state e ativa RLS.

As políticas só permitem acesso quando:
auth.uid() = user_id

Isso significa que a chave pública do navegador não dá a um aluno permissão para
ler ou editar o estado de outro aluno.

ARQUIVOS NOVOS
- config.js
- supabase-setup.sql

CONFIGURAÇÃO EM 5 PASSOS

1. Crie um projeto no Supabase.

2. Abra SQL Editor e execute o conteúdo completo de:
   supabase-setup.sql

3. Abra Project Settings > API e copie:
   - Project URL
   - anon public key

4. Abra config.js e substitua:
   COLE_AQUI_SUA_SUPABASE_URL
   COLE_AQUI_SUA_SUPABASE_ANON_KEY

   NUNCA use a service_role key no navegador.

5. No Supabase > Authentication > URL Configuration:
   - Site URL: coloque a URL publicada do Meu Cronograma;
   - Redirect URLs: adicione a mesma URL.

Depois, envie todos os arquivos atualizados para o GitHub Pages.

OBSERVAÇÃO SOBRE E-MAIL
Se a confirmação de e-mail estiver habilitada no Supabase, o aluno deverá
confirmar o cadastro antes do primeiro login.

PRESERVADO
- motor adaptativo de importação;
- DOCX/PDF;
- calendário completo e compacto;
- interface mobile;
- filtros;
- progresso;
- conclusão;
- modo claro/escuro;
- PWA básico.

IMPORTANTE
Esta V20 não usa apenas um “login visual”. O isolamento é aplicado no banco.
