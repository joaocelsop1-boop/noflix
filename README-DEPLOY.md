# NOFLIX — Deploy (Next.js + backend PHP + MySQL)

Arquitetura: o front Next.js (`app`, porta 3000) fala com o backend PHP
(`php`, Apache + PHP 8.2, porta 80 interna) por `PHP_BACKEND_URL`, e o PHP
fala com o MySQL (`db`, porta 3306 só interna). O PHP é quem conversa com
o painel Xtream (Sigma) — usuário/senha do painel nunca chegam ao navegador:
o player usa `stream.php`, que faz proxy com auth (login + plano ativo).

## 1. O que vai no repositório

```
noflix/
├── Dockerfile                  # Next.js (node:20-alpine, npm ci → build → start :3000)
├── docker-compose.yml          # app + php + db
├── .env.example                # placeholders (NUNCA commitar o .env real)
├── php-backend/
│   ├── Dockerfile              # php:8.2-apache + pdo_mysql
│   ├── config.php              # DB via env (DB_HOST/DB_NAME/DB_USER/DB_PASS)
│   ├── api.php                 # actions Xtream + novas: me, login, logout, plans, register
│   ├── stream.php              # proxy de stream (não alterado)
│   ├── login.php / logout.php / profiles.php
│   ├── admin.php / admin_login.php
│   ├── database.sql            # schema + seed (planos, settings, admin)
│   └── cache/                  # cache do catálogo (volume php-cache)
└── README-DEPLOY.md            # este arquivo
```

## 2. Deploy no Coolify

1. Suba este repositório (branch com os arquivos acima) para o Git.
2. No Coolify: **New Resource → Docker Compose** e aponte para o repositório.
3. **Build Pack: Docker Compose** (o Coolify usa o `docker-compose.yml` da raiz).
4. **Endereço do app: `cineplus.shop/app`** — o app vive no caminho `/app`
   do domínio (o site de vendas fica na raiz `cineplus.shop/`). No Coolify,
   adicione o domínio `cineplus.shop` no serviço `app` (porta 3000) com
   **prefixo de caminho `/app`** (Traefik roteia `/app/*` para o app e o
   resto para o site). O `basePath: "/app"` já está no `next.config.ts`.
5. O serviço `php` NÃO precisa de domínio próprio nem porta exposta: o
   admin e as APIs chegam por ele pelo rewrite `/app/php/*` do Next.js
   (o front server-side usa a URL interna `http://php:80`). O admin fica em
   `https://cineplus.shop/app/php/admin.php`.
6. Variáveis de ambiente (Coolify → Environment Variables do recurso):
   | Chave | Valor |
   |---|---|
   | `DB_NAME` | `minetv` |
   | `DB_USER` | `noflix` (ou o que preferir) |
   | `DB_PASS` | senha forte (gere uma) |
   | `DB_ROOT_PASS` | senha forte diferente (gere outra) |
   | `PHP_BACKEND_URL` | `http://php:80` |
   | `TMDB_API_KEY` | chave TMDB (opcional, só no servidor) |
7. Deploy. Aguarde os 3 serviços ficarem saudáveis (`db` tem healthcheck).

## 3. Teste local (antes do Coolify, opcional)

```bash
cd noflix
cp .env.example .env   # ajuste DB_PASS e DB_ROOT_PASS
docker compose up -d --build
docker compose ps
```

## 4. Importar o banco (só na primeira subida)

O `database.sql` cria `settings`, `plans`, `users`, `orders`, `commissions`,
`profiles` e `user_ratings`, com planos de exemplo e o admin padrão.
Importação manual (o arquivo é reimportável com segurança):

```bash
docker compose exec -T db mysql -u root -p"$DB_ROOT_PASS" "$DB_NAME" \
  < php-backend/database.sql
```

No Coolify, rode o equivalente no terminal do serviço `db` (ou via
`docker compose exec` no servidor), com o arquivo `php-backend/database.sql`
do repositório.

> Nota: no fim do `database.sql` há dois `ALTER TABLE ... ADD COLUMN IF NOT
> EXISTS` (sintaxe só de MariaDB). No MySQL 8.0 eles dão erro de sintaxe —
> é esperado e inofensivo: as colunas já existem no `CREATE TABLE` e todas
> as tabelas já foram criadas antes desses ALTERs. Não reimporte por cima
> esperando que eles "passem"; ignore o erro.

## 5. Configurar painel Xtream e Mercado Pago (no admin)

1. Acesse o admin: **https://cineplus.shop/app/php/admin.php**
   (local: http://localhost:3000/app/php/admin.php).
2. Login inicial (criado pelo `database.sql` — **troque a senha no primeiro
   acesso** em Administradores → Trocar minha senha):
   - E-mail: `admin@minetv.tv`
   - Senha: `admin123`
3. Em **Configurações / Painel**, preencha:
   - URL do painel Xtream (`sigma_url`), usuário (`sigma_username`) e senha
     (`sigma_password`) — o admin aceita até a URL completa do M3U; o
     `config.php` normaliza para `esquema://host:porta`.
   - `trial_hours` (horas do teste grátis no cadastro; padrão 3).
   - `affiliate_percent` (comissão Indique e Ganhe; padrão 10%).
4. Em **Pagamentos**, preencha o token do Mercado Pago (`mp_access_token`)
   para gerar QR Pix automático nos pedidos; sem ele, o checkout cai para
   pagamento manual com a `pix_key` do admin.
5. Use **Testar conexão** no admin para validar o painel Xtream antes de
   liberar o acesso aos clientes.

## 6. Teste de ponta a ponta

```bash
# Planos públicos (sem login)
curl http://localhost:8080/api.php?action=plans

# Sessão anônima
curl http://localhost:8080/api.php?action=me
# → {"loggedIn":false,"user":null,"canWatch":false}

# Cadastro (cria usuário trial e já loga — guarda o cookie!)
curl -c cookies.txt -X POST http://localhost:8080/api.php?action=register \
  -d "name=Teste&email=teste@exemplo.com&password=123456"
# → {"ok":true,"user":{...},"canWatch":true}

# Login / logout
curl -c cookies.txt -X POST http://localhost:8080/api.php?action=login \
  -d "email=teste@exemplo.com&password=123456"
curl -b cookies.txt -X POST http://localhost:8080/api.php?action=logout
# → {"ok":true}
```

Depois, no front (`http://localhost:3000`): faça login com a conta criada,
abra um título e dê play — o player deve requisitar `stream.php` (nunca a
URL direta do painel). Sem plano ativo/vencido, o `stream.php` responde 403.

## 7. Endpoints do backend PHP

| URL | Uso |
|---|---|
| `/api.php?action=plans` | Planos ativos (público) |
| `/api.php?action=me` | Sessão atual (público) |
| `/api.php?action=login` (POST) | Login por e-mail/senha |
| `/api.php?action=register` (POST) | Cadastro + trial |
| `/api.php?action=logout` (POST) | Logout |
| `/api.php?action=public_catalog` | Catálogo público (sem login) |
| `/api.php?action=get_*` | Catálogo Xtream (exige login) |
| `/stream.php?type=live&id=…` | Ao vivo (m3u8 reescrito) |
| `/stream.php?type=movie&id=…&ext=mp4` | Filme/série (Range/206) |
| `/admin.php` | Painel admin |
| `/login.php` | Login/cadastro (páginas PHP legadas) |

## 8. Observações

- O build do Next.js (`npm run build`) NÃO foi rodado aqui — ele roda no
  deploy (Coolify) ou com `docker compose up --build`.
- `php -l` passou em todos os 8 arquivos PHP (verificado em 2026-11-26).
  Não houve teste funcional ao vivo (sem MySQL/Docker neste ambiente):
  valide os passos 4–6 na primeira subida.
- As actions novas da API aceitam tanto form-urlencoded quanto JSON no body.
- A trava de login (5 erros = 15 min) vale para `api.php?action=login`,
  igual à `login.php`.
