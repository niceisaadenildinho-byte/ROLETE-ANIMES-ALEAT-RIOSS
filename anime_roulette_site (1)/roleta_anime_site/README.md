# Anime Roulette (site)

Primeira etapa do projeto: versão web responsiva e instalável como PWA quando hospedada em HTTPS.

## O que já funciona
- Filtros por ano (2011–2026), gênero, formato e pesquisa por nome.
- Sorteio aleatório sem repetir os últimos resultados enquanto houver opções diferentes.
- Capas, sinopse, gêneros, número de episódios e nota quando a fonte fornece esses dados.
- Dados dos animes guardados no IndexedDB do navegador. Ao voltar ao site no mesmo aparelho/navegador, a roleta usa os registros salvos sem consultar a API a cada giro. As capas são carregadas quando exibidas e podem ficar no cache do navegador.
- Preparação progressiva até 2.000 títulos, enquanto a roleta já pode ser usada com os títulos baixados.
- Cache do app shell para uso posterior como PWA.

## Fonte de dados e Crunchyroll
Esta versão usa a API pública GraphQL da AniList para títulos e metadados. Ela **não** confirma a disponibilidade de cada anime na Crunchyroll Brasil. A Crunchyroll não oferece uma exportação pública completa do catálogo para este app.

## Como abrir
1. Extraia o ZIP.
2. Para testar, abra `index.html` em um navegador atualizado. A consulta à API requer internet.
3. Para instalar como aplicativo PWA, publique os arquivos em um endereço HTTPS e use a opção "Adicionar à tela inicial" do navegador.

O APK será a segunda etapa, usando esta mesma base de interface e lógica.
