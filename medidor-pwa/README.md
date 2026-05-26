# 💧 MedidorAI — PWA

Sistema de leitura automática de medidores com IA.

---

## Pré-requisitos

- Node.js 18+
- PostgreSQL rodando localmente ou em servidor

---

## Passo a passo de instalação

### 1. Entre na pasta e instale as dependências

```bash
cd medidor-pwa
npm install
```

### 2. Configure o ambiente

```bash
cp .env.example .env
nano .env
```

Preencha as variáveis:

```env
DATABASE_URL="postgresql://USUARIO:SENHA@localhost:5432/medidor_db"
JWT_SECRET=qualquer_string_longa_e_aleatoria_aqui_ex_abc123xyz
JWT_EXPIRES_IN=8h
GEMINI_API_KEY=sua_chave_gemini
PORT=3005
```

### 3. Crie o banco de dados no PostgreSQL

```bash
# Entre no psql
sudo -u postgres psql

# Dentro do psql:
CREATE DATABASE medidor_db;
CREATE USER medidor_user WITH PASSWORD 'suasenha';
GRANT ALL PRIVILEGES ON DATABASE medidor_db TO medidor_user;
\q
```

Atualize o `DATABASE_URL` no `.env` com o usuário e senha criados.

### 4. Gere o Prisma Client e rode as migrations

```bash
npm run db:generate
npm run db:migrate
```

Quando pedir um nome para a migration, coloque: `init`

### 5. Popule o banco com dados iniciais (seed)

```bash
npm run db:seed
```

Isso cria os usuários de teste:
- `admin@medidor.app` / `admin123`
- `gestor@medidor.app` / `gestor123`
- `leitor@medidor.app` / `leitor123`

### 6. Suba o servidor

```bash
npm start
```

Acesse: **http://localhost:3005** (ou pelo IP da rede, ex: http://192.168.0.81:3005)

---

## Estrutura do projeto

```
medidor-pwa/
├── prisma/
│   ├── schema.prisma      ← Modelos do banco
│   └── seed.js            ← Dados iniciais
├── src/
│   ├── server.js          ← Entry point
│   ├── routes/
│   │   └── index.js       ← Todas as rotas da API
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── usersController.js
│   │   ├── condominiosController.js
│   │   ├── medidoresController.js
│   │   └── leiturasController.js
│   ├── middlewares/
│   │   └── auth.js        ← JWT + roles
│   ├── services/
│   │   └── geminiService.js
│   └── utils/
│       └── prisma.js
├── public/
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js
│   ├── css/app.css
│   └── js/
│       ├── api.js
│       └── app.js
├── uploads/               ← Fotos (criado automaticamente)
├── .env.example
└── package.json
```

---

## Rodando em produção com PM2

```bash
npm install -g pm2
pm2 start src/server.js --name medidor-ai
pm2 save
pm2 startup
```

---

## Rotas da API

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | /api/auth/login | — | Login |
| GET | /api/condominios | ✓ | Listar condomínios |
| GET | /api/medidores | ✓ | Listar medidores |
| POST | /api/leituras/analisar | ✓ | Analisar foto com IA |
| POST | /api/leituras | ✓ | Salvar leitura |
| GET | /api/leituras/dashboard | ✓ | Dashboard do dia |
| GET | /api/leituras/relatorio | ✓ | Relatório mensal |
| GET | /api/users | ADMIN | CRUD usuários |
| POST | /api/condominios | ADMIN | Criar condomínio |
