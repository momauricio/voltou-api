# Deploy e migrações do banco (Prisma Migrate)

Runbook para o VPS de produção. Todos os comandos rodam no diretório do
`compose.yml` da API (onde está o `.env`).

> **Merge e deploy só com OK do Mauricio.**

## 1. Contexto

Até aqui o container rodava `npx prisma db push --skip-generate` a cada boot.
Problemas disso:

- **Muta o schema sem revisão**: qualquer diferença entre `schema.prisma` e o
  banco é aplicada automaticamente ao subir/reiniciar o container (inclusive
  `restart: unless-stopped` após crash).
- **Pode perder dados**: `db push` pode dropar colunas/tabelas/índices ou
  falhar no meio, sem histórico do que foi feito e sem backup prévio.
- **Sem histórico**: o banco de prod não tem `_prisma_migrations`, então não
  dá para saber o que foi aplicado nem usar `prisma migrate deploy`.

Agora o `CMD` do `Dockerfile` é só `node dist/main.js`. Alterar schema virou
passo **manual e explícito**: parar → backup → `prisma migrate deploy` →
conferir → subir.

Para isso existe a migração `20260901000000_baseline`, que cria o schema base
(estado anterior às migrações versionadas). Em banco vazio ela roda
normalmente; **em prod ela e as demais são só marcadas como aplicadas**
(`migrate resolve --applied`), porque o banco já tem esse schema (criado por
`db push`).

Migrações do repo (todas já refletidas no schema de prod):

```
20260901000000_baseline
20260902120000_lojista_owner_phone_google
20260902140000_store_slug_unique
20260902213000_checkout_staff_user_id
20260902233000_store_fulfillment_settings
20260906033000_checkout_tracking_code
20261026120000_prod_parity_shipping_notify
```

> Os comentários dentro de alguns `migration.sql` antigos ainda dizem
> "Empty database: use `npx prisma db push`". Isso está **desatualizado**:
> banco vazio agora usa `npx prisma migrate deploy` (o baseline cria tudo).
> Esses arquivos não são editados de propósito (o checksum fica registrado em
> `_prisma_migrations`).

## 2. Pré-requisitos

- Acesso SSH ao VPS, `docker` e `docker compose`.
- Código novo (este branch) já no diretório do compose (`git pull`/checkout),
  **sem** ainda rodar `docker compose up`.
- Janela curta de indisponibilidade da API (minutos).

### 2.1 Ler `DATABASE_URL` e identificar o arquivo `.db`

Com a API **ainda rodando**:

```bash
docker exec voltou-api printenv DATABASE_URL
# esperado algo como: file:/app/data/<arquivo>.db

docker exec voltou-api ls -la /app/data
```

Anote o nome do arquivo. Nos comandos abaixo, defina no shell do host:

```bash
DB_FILE=<arquivo>.db          # ex.: voltou.db
```

> Se `DATABASE_URL` for relativa (ex.: `file:./data/x.db`), confirme com
> `ls` onde o arquivo realmente está antes de seguir. O volume
> `voltou_api_data` é montado em `/app/data`.

## 3. Antes: taguear a imagem atual (rollback)

```bash
docker image ls
docker inspect -f '{{.Config.Image}} {{.Image}}' voltou-api   # nome e ID da imagem em uso

TAG=voltou-api:pre-migrate-$(date +%Y%m%d)
docker tag "$(docker inspect -f '{{.Image}}' voltou-api)" "$TAG"
docker image ls voltou-api
```

Anote também o nome da imagem do compose (primeiro campo do `inspect`, ex.:
`<projeto>-voltou-api`) — é ele que o rollback precisa sobrescrever.

## 4. Build da imagem nova (sem derrubar a atual)

```bash
docker compose build voltou-api
```

O container em execução continua usando a imagem antiga até o `up`.

## 5. Parar a API

```bash
docker compose stop voltou-api
```

O SQLite precisa estar sem escritores para o backup ser consistente (sem
transação pela metade e com o WAL fechado). **Não** use `down` (não precisa
remover o container).

## 6. Backup

```bash
mkdir -p backups
TS=$(date +%Y%m%d-%H%M%S)
docker cp "voltou-api:/app/data/$DB_FILE" "./backups/${DB_FILE%.db}-$TS.db"

# Se existirem -wal / -shm (ver `ls` do passo 2.1), copie também:
docker cp "voltou-api:/app/data/$DB_FILE-wal" "./backups/${DB_FILE%.db}-$TS.db-wal" 2>/dev/null || true
docker cp "voltou-api:/app/data/$DB_FILE-shm" "./backups/${DB_FILE%.db}-$TS.db-shm" 2>/dev/null || true

ls -la backups/
sha256sum "./backups/${DB_FILE%.db}-$TS.db"
docker compose run --rm --no-deps voltou-api sha256sum "/app/data/$DB_FILE"
```

Tamanho e sha256 do backup **devem bater** com o arquivo do volume. Se não
baterem, PARE.

Guarde uma cópia fora do VPS se possível (`scp`).

## 7. Diagnóstico

```bash
docker compose run --rm --no-deps voltou-api npx prisma migrate status
```

Como interpretar:

- **Todas as 7 em "Following migrations have not yet been applied"** → banco
  sem `_prisma_migrations` (caso esperado, criado por `db push`). Siga para o
  passo 8.
- **Aparece `20260723123000_fulfillment_shipping_notify` como aplicada no
  banco e ausente localmente** ("not found locally") → era uma migração WIP
  que não existe neste repo (e não deve ser adicionada). Com o backup feito,
  apague só essa linha:

  ```bash
  echo "DELETE FROM \"_prisma_migrations\" WHERE migration_name = '20260723123000_fulfillment_shipping_notify';" \
    | docker compose run --rm --no-deps -T voltou-api npx prisma db execute --stdin --schema prisma/schema.prisma
  ```

  Rode o `migrate status` de novo e siga.
- **Alguma migração com falha** ("failed" / "P3009") ou qualquer coisa
  inesperada → **PARE**. Não rode deploy nem resolve. Suba de novo a imagem
  antiga (passo 12) e investigue.

## 8. Primeira vez: baseline

Só neste primeiro deploy (banco criado por `db push`). Marca as 7 migrações
como aplicadas **sem executar SQL** (só grava linhas em `_prisma_migrations`):

```bash
docker compose run --rm --no-deps -T voltou-api sh -s < scripts/db-baseline-prod.sh
```

> A imagem runtime não copia `scripts/` (só `package.json`, `prisma/` e
> `dist/`), então `npm run db:baseline:prod` **não** funciona dentro do
> container; por isso o script vai do host via stdin (`-T` + `sh -s`). Ele
> roda em `/app`, onde estão `prisma/migrations` e o CLI `prisma`.
> (`npm run db:baseline:prod` serve fora do container, com o repo completo.)

O script (`scripts/db-baseline-prod.sh`) é idempotente: migração já
registrada (P3008) é tratada como ok; qualquer outro erro aborta.

Equivalente manual:

```bash
for m in \
  20260901000000_baseline \
  20260902120000_lojista_owner_phone_google \
  20260902140000_store_slug_unique \
  20260902213000_checkout_staff_user_id \
  20260902233000_store_fulfillment_settings \
  20260906033000_checkout_tracking_code \
  20261026120000_prod_parity_shipping_notify
do
  docker compose run --rm --no-deps voltou-api npx prisma migrate resolve --applied "$m"
done
```

## 9. `migrate deploy`

```bash
docker compose run --rm --no-deps voltou-api npx prisma migrate deploy
```

Esperado: `No pending migrations to apply.`

## 10. Conferência

```bash
docker compose run --rm --no-deps voltou-api npx prisma migrate status
```

Esperado: `Database schema is up to date!`

```bash
docker compose run --rm --no-deps voltou-api sh -c \
  'npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script'
```

Esperado: `-- This is an empty migration.`

> Use aspas simples no `sh -c` para que `$DATABASE_URL` seja expandida
> **dentro** do container (vem do `.env`), não no host.

Se o diff **não** for vazio: **PARE e não suba** a imagem nova. O schema de
prod diverge do `schema.prisma`; analise o SQL impresso antes de qualquer
coisa (ou faça rollback, passo 12).

## 11. Subir

```bash
docker compose up -d voltou-api
docker compose logs -f voltou-api        # Ctrl+C para sair
curl -fsS http://127.0.0.1:3010/whatsapp/health
```

Nos logs **não** deve aparecer mais `prisma db push`.

## 12. Rollback

```bash
docker compose stop voltou-api

# (só se necessário, ver abaixo) restaurar o .db do backup
docker cp "./backups/<arquivo>-<TS>.db" "voltou-api:/app/data/$DB_FILE"
docker compose run --rm --no-deps voltou-api sh -c "rm -f /app/data/$DB_FILE-wal /app/data/$DB_FILE-shm"
# se o backup tinha -wal/-shm, copie-os de volta também com docker cp

# voltar para a imagem tagueada no passo 3
docker tag voltou-api:pre-migrate-AAAAMMDD <nome-da-imagem-do-compose>
docker compose up -d --no-build voltou-api
```

Alternativa para a imagem: `git checkout <commit-anterior>` +
`docker compose build voltou-api` + `docker compose up -d voltou-api`.

Quando restaurar o `.db`:

- `migrate resolve --applied` **só grava linhas em `_prisma_migrations`**; não
  altera tabelas de dados. A imagem antiga (com `db push` no boot) ignora essa
  tabela. Então, se só foi feito o baseline, **rollback de código funciona sem
  restaurar o `.db`**.
- Restaurar o `.db` é necessário só se um `migrate deploy` **real** tiver
  alterado tabelas (deploys futuros com migrações novas) — e aí qualquer dado
  escrito após o backup é perdido.

## 13. Deploys futuros

Com o baseline feito, todo deploy segue:

```bash
docker compose build voltou-api
docker compose stop voltou-api
# backup (passo 6)
docker compose run --rm --no-deps voltou-api npx prisma migrate deploy
docker compose run --rm --no-deps voltou-api npx prisma migrate status   # "Database schema is up to date!"
docker compose up -d voltou-api
```

Sem migrações novas, o `migrate deploy` diz `No pending migrations to apply.`
e o backup pode ser dispensado a critério de quem opera (recomendado mantê-lo).

## 14. Banco novo/vazio (dev, CI, ambiente novo)

```bash
npx prisma migrate deploy     # ou: npm run db:migrate:deploy
```

O baseline cria o schema base e as demais migrações completam o resto. **Não**
use `db:baseline:prod` em banco vazio.

Para desenvolvimento local continua valendo `npm run db:migrate`
(`prisma migrate dev`) para criar migrações novas.

## 15. Checklist final

- [ ] `DATABASE_URL` lida e arquivo `.db` identificado
- [ ] Imagem atual tagueada `voltou-api:pre-migrate-AAAAMMDD`
- [ ] Imagem nova buildada
- [ ] API parada antes do backup
- [ ] Backup feito, tamanho e sha256 conferidos (cópia fora do VPS, se possível)
- [ ] `migrate status` interpretado (linha WIP `20260723123000_...` removida, se existia)
- [ ] Baseline (`db:baseline:prod`) executado — só na primeira vez
- [ ] `migrate deploy` → `No pending migrations to apply.`
- [ ] `migrate status` → `Database schema is up to date!`
- [ ] `migrate diff` → `-- This is an empty migration.`
- [ ] `up -d`, logs sem `db push`, health check OK

**Merge/deploy só com OK do Mauricio.**
