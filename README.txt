MEU CRONOGRAMA ACADÊMICO — V15.1

CORREÇÃO URGENTE
A V15 tinha um erro de JavaScript: os novos filtros utilizavam um estado chamado
"ui", mas esse objeto não tinha sido inicializado. O resultado era que a página
parava de renderizar e, quando o navegador estava em modo escuro, aparecia apenas
um fundo preto.

CORRIGIDO
- estado dos filtros inicializado corretamente;
- tela volta a renderizar normalmente;
- modo claro é o padrão para novos usuários;
- modo Escuro e Automático continuam disponíveis;
- cronogramas das versões V13/V14 são preservados usando a mesma chave localStorage;
- busca, filtros, progresso e conclusão continuam ativos;
- leitura DOCX e PDF permanece igual à versão anterior.

TEMA
Você pode alternar entre Claro, Sistema e Escuro no topo ou no Perfil.
