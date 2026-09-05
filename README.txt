MEU CRONOGRAMA ACADÊMICO — V20.1
LOGIN POR E-MAIL + CADASTRO/LOGIN AUTOMÁTICO COM GOOGLE

O QUE MUDOU
A versão V20 foi preservada como base.

Agora o aluno pode:
- criar conta com e-mail e senha;
- entrar com e-mail e senha;
- OU clicar em "Continuar com Google";
- no primeiro acesso com Google, a conta é criada automaticamente;
- nos acessos seguintes, o mesmo botão entra na conta existente.

PRIVACIDADE
Nada muda nas regras de segurança:
- cada usuário recebe um UUID no Supabase Auth;
- os dados ficam associados a esse UUID;
- RLS continua impedindo que um usuário acesse o estado de outro.

CONFIGURAÇÃO DO GOOGLE NO SUPABASE

1. Mantenha o Supabase configurado normalmente:
   - execute supabase-setup.sql
   - configure config.js com Project URL + anon public key

2. No Google Cloud Console:
   - crie ou selecione um projeto;
   - configure a tela de consentimento OAuth;
   - crie credenciais OAuth 2.0 do tipo Web application.

3. No Supabase:
   Authentication > Providers > Google

   Copie o Callback URL informado pelo Supabase.

4. No Google Cloud Console:
   adicione o Callback URL do Supabase em:
   Authorized redirect URIs

5. Copie do Google:
   - Client ID
   - Client Secret

6. Cole no Supabase:
   Authentication > Providers > Google

7. Ative o provider Google.

8. Em Supabase > Authentication > URL Configuration:
   Site URL:
   coloque a URL do seu GitHub Pages.

   Redirect URLs:
   adicione também a URL do seu GitHub Pages.

EXPERIÊNCIA DO ALUNO
- o aluno abre o site;
- clica em "Continuar com Google";
- escolhe a conta Google;
- volta automaticamente para o Meu Cronograma;
- seu espaço individual é criado ou carregado.

PRESERVADO
- login tradicional da V20;
- criação de conta tradicional;
- importação adaptativa;
- DOCX/PDF;
- calendário;
- mobile;
- PWA;
- filtros;
- progresso;
- conclusão;
- modo claro/escuro.
