# Migração oficial: Railway, Vercel e Bunny

Nunca cole valores secretos em tickets, commits ou no navegador. Cadastre-os
diretamente nos painéis e marque como `Secret`/`Sealed` quando disponível.

## 1. Antes de mudar o frontend

1. Crie o PostgreSQL no projeto Railway oficial.
2. Migre os dados do PostgreSQL antigo para o novo. Um banco vazio cria as
   tabelas no deploy, mas não recupera colaboradores, convites, cursos nem
   progresso.
3. Copie do Railway antigo o **mesmo** `CPF_HASH_SECRET`. Trocar esse valor
   invalida os CPFs dos convites que ainda aguardam ativação.
4. Gere um domínio público para o serviço backend.

## 2. Bunny Storage para capas e materiais

O Bunny Stream continua exclusivo para vídeos. Capas, PDFs, Word, planilhas,
apresentações e arquivos compactados usam uma Storage Zone separada.

1. No Bunny, abra **Storage > Add Storage Zone**.
2. Crie uma **nova** zone com `S3 Compatibility` habilitado. Essa opção não
   pode ser ligada depois em uma zone antiga.
3. Para a América do Sul, enquanto S3 não estiver disponível em São Paulo,
   use `New York (ny)`.
4. Em **Access**, copie o nome da zone e a `Storage Zone Password`.
5. Não use a API Key global nem a API Key da biblioteca Stream como senha de
   Storage.

## 3. Variáveis do backend no Railway

Abra o serviço do backend, entre em **Variables > Raw Editor** e use este
modelo. Substitua todos os valores entre `<...>`; não inclua os sinais `<` e
`>`.

```dotenv
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
API_PUBLIC_URL=https://<novo-backend>.up.railway.app

CLERK_SECRET_KEY=<sk_live_da_mesma_instancia_clerk_do_frontend>
CLERK_AUTHORIZED_PARTIES=https://<frontend-estavel>.vercel.app,https://plataforma.lilianarruda.com.br
CPF_HASH_SECRET=<copiar_exatamente_do_railway_antigo>
UPLOAD_TOKEN_SECRET=<segredo_aleatorio_longo>

FRONTEND_URL=https://<frontend-estavel>.vercel.app
FRONTEND_URLS=https://<frontend-estavel>.vercel.app,https://plataforma.lilianarruda.com.br
VERCEL_FRONTEND_PROJECTS=<slug_exato_do_projeto_vercel>
RH_ALLOWED_EMAILS=<email_rh_1>,<email_rh_2>

BUNNY_LIBRARY_ID=<id_da_biblioteca_stream>
BUNNY_READ_ONLY_API_KEY=<read_only_api_key_da_biblioteca_stream>
BUNNY_EMBED_TOKEN_KEY=<embed_view_token_key_da_biblioteca_stream>

BUNNY_STORAGE_ZONE_NAME=<nome_da_storage_zone_s3>
BUNNY_STORAGE_PASSWORD=<storage_zone_password>
BUNNY_STORAGE_REGION=ny
BUNNY_STORAGE_S3_ENDPOINT=https://ny-s3.storage.bunnycdn.com
BUNNY_STORAGE_PREFIX=course-assets
S3_URL_STYLE=path
```

Observações:

- Se o serviço PostgreSQL não se chamar `Postgres`, troque esse nome na
  referência `${{Postgres.DATABASE_URL}}`.
- Não cadastre `PORT`; o Railway fornece essa variável automaticamente.
- Não cadastre `BUNNY_API_KEY` de escrita no Railway. A API usa somente a chave
  read-only para consultar vídeos.
- As credenciais `BUNNY_STORAGE_*` ficam somente no Railway.
- Depois de editar variáveis, revise e aplique o deploy pendente.

## 4. Variáveis do frontend na Vercel

Em **Project > Settings > Environment Variables**, cadastre em `Production` e
`Preview`:

```dotenv
NEXT_PUBLIC_API_URL=https://<novo-backend>.up.railway.app
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<pk_live_da_instancia_clerk>
CLERK_SECRET_KEY=<sk_live_da_mesma_instancia_clerk>

BUNNY_LIBRARY_ID=<id_da_biblioteca_stream>
BUNNY_API_KEY=<api_key_de_escrita_da_biblioteca_stream>
BUNNY_UPLOAD_ALLOWED_ORIGINS=https://<frontend-estavel>.vercel.app,https://plataforma.lilianarruda.com.br
```

Não cadastre na Vercel:

- `BUNNY_STORAGE_PASSWORD`
- `BUNNY_STORAGE_ZONE_NAME`
- `BUNNY_READ_ONLY_API_KEY`
- `BUNNY_EMBED_TOKEN_KEY`
- `DATABASE_URL`

`BLOB_STORE_ID` e `BLOB_WEBHOOK_PUBLIC_KEY` são apenas legado. Capas e
materiais novos não usam Vercel Blob. Não exclua o Blob antigo antes de
confirmar que todos os materiais antigos ainda necessários foram reenviados ou
migrados.

## 5. Ordem segura de publicação

1. Migre o banco e publique o backend Railway.
2. Confirme que `https://<novo-backend>.up.railway.app/api` responde.
3. Atualize `NEXT_PUBLIC_API_URL` na Vercel e faça um redeploy.
4. Teste login, RH, cursos, upload de uma capa, upload de um PDF e download com
   uma conta de aluno.
5. Só depois adicione `plataforma.lilianarruda.com.br` na Vercel/Hostinger.
6. Quando o domínio estiver validado, altere `FRONTEND_URL` para o domínio
   oficial e mantenha o endereço Vercel em `FRONTEND_URLS` durante a transição.
