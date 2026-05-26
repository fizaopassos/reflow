const prisma = require('../utils/prisma');

// Filtro de condomínios por role
function whereByRole({ role, id: userId }, condoId) {
  const base = { ativo: true, ...(condoId ? { id: condoId } : {}) };
  if (role === 'ADMIN')  return base;
  if (role === 'GESTOR') return { ...base, gestores: { some: { user_id: userId } } };
  if (role === 'LEITOR') return { ...base, leitores: { some: { user_id: userId } } };
  return base;
}

async function listar(req, res) {
  const condominios = await prisma.condominio.findMany({
    where: whereByRole(req.user),
    include: { _count: { select: { unidades: true } } },
    orderBy: { nome: 'asc' },
  });
  res.json(condominios);
}

async function buscar(req, res) {
  const condo = await prisma.condominio.findUnique({
    where: { id: req.params.id },
    include: {
      unidades: {
        where: { ativo: true },
        include: { medidores: { where: { ativo: true } } },
        orderBy: { identificador: 'asc' },
      },
      gestores: { include: { user: { select: { id: true, nome: true, email: true } } } },
      leitores: { include: { user: { select: { id: true, nome: true, email: true } } } },
    },
  });
  if (!condo) return res.status(404).json({ erro: 'Condomínio não encontrado.' });
  res.json(condo);
}

async function criar(req, res) {
  const { nome, endereco, cidade } = req.body;
  if (!nome) return res.status(400).json({ erro: 'nome é obrigatório.' });
  const condo = await prisma.condominio.create({ data: { nome, endereco, cidade } });
  res.status(201).json(condo);
}

async function atualizar(req, res) {
  const { nome, endereco, cidade, ativo } = req.body;
  const condo = await prisma.condominio.update({
    where: { id: req.params.id },
    data: { nome, endereco, cidade, ativo },
  });
  res.json(condo);
}

// ── GESTORES ──────────────────────────────────────────────────
async function atribuirGestor(req, res) {
  const { user_id } = req.body;
  await prisma.condominioGestor.upsert({
    where: { condominio_id_user_id: { condominio_id: req.params.id, user_id } },
    update: {},
    create: { condominio_id: req.params.id, user_id },
  });
  res.json({ ok: true });
}

async function removerGestor(req, res) {
  await prisma.condominioGestor.delete({
    where: { condominio_id_user_id: { condominio_id: req.params.id, user_id: req.params.userId } },
  });
  res.json({ ok: true });
}

// ── LEITORES ──────────────────────────────────────────────────
async function atribuirLeitor(req, res) {
  const { user_id } = req.body;
  await prisma.condominioLeitor.upsert({
    where: { condominio_id_user_id: { condominio_id: req.params.id, user_id } },
    update: {},
    create: { condominio_id: req.params.id, user_id },
  });
  res.json({ ok: true });
}

async function removerLeitor(req, res) {
  await prisma.condominioLeitor.delete({
    where: { condominio_id_user_id: { condominio_id: req.params.id, user_id: req.params.userId } },
  });
  res.json({ ok: true });
}

module.exports = { listar, buscar, criar, atualizar, atribuirGestor, removerGestor, atribuirLeitor, removerLeitor };
