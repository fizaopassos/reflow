const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');

async function listar(req, res) {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, nome: true, role: true, is_admin_local: true, ativo: true, criado_em: true },
    orderBy: { nome: 'asc' },
  });
  res.json(users);
}

async function buscar(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, email: true, nome: true, role: true, is_admin_local: true, ativo: true, criado_em: true },
  });
  if (!user) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  res.json(user);
}

async function criar(req, res) {
  const { email, senha, nome, role, is_admin_local } = req.body;
  if (!email || !senha || !nome) {
    return res.status(400).json({ erro: 'email, senha e nome são obrigatórios.' });
  }

  const existe = await prisma.user.findUnique({ where: { email } });
  if (existe) return res.status(409).json({ erro: 'Email já cadastrado.' });

  const hash = await bcrypt.hash(senha, 10);
  const user = await prisma.user.create({
    data: { email, senha: hash, nome, role: role || 'LEITOR', is_admin_local: !!is_admin_local },
    select: { id: true, email: true, nome: true, role: true, is_admin_local: true },
  });
  res.status(201).json(user);
}

async function atualizar(req, res) {
  const { nome, role, is_admin_local, ativo, senha } = req.body;
  const data = {};
  if (nome !== undefined) data.nome = nome;
  if (role !== undefined) data.role = role;
  if (is_admin_local !== undefined) data.is_admin_local = is_admin_local;
  if (ativo !== undefined) data.ativo = ativo;
  if (senha) data.senha = await bcrypt.hash(senha, 10);

  const user = await prisma.user.update({
    where: { id: req.params.id },
    data,
    select: { id: true, email: true, nome: true, role: true, is_admin_local: true, ativo: true },
  });
  res.json(user);
}

async function remover(req, res) {
  // Soft delete — só desativa
  await prisma.user.update({ where: { id: req.params.id }, data: { ativo: false } });
  res.json({ ok: true });
}

module.exports = { listar, buscar, criar, atualizar, remover };
