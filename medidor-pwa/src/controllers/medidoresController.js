const prisma = require('../utils/prisma');

// ── UNIDADES ──────────────────────────────────────────────────

async function listarUnidades(req, res) {
  const { condominio_id } = req.query;
  const unidades = await prisma.unidade.findMany({
    where: { ativo: true, ...(condominio_id ? { condominio_id } : {}) },
    include: {
      medidores: { where: { ativo: true } },
      condominio: { select: { id: true, nome: true } },
    },
    orderBy: { identificador: 'asc' },
  });
  res.json(unidades);
}

async function criarUnidade(req, res) {
  const { condominio_id, identificador, andar, bloco } = req.body;
  if (!condominio_id || !identificador) {
    return res.status(400).json({ erro: 'condominio_id e identificador são obrigatórios.' });
  }
  const unidade = await prisma.unidade.create({
    data: { condominio_id, identificador, andar, bloco },
  });
  res.status(201).json(unidade);
}

async function atualizarUnidade(req, res) {
  const { identificador, andar, bloco, ativo } = req.body;
  const unidade = await prisma.unidade.update({
    where: { id: req.params.id },
    data: { identificador, andar, bloco, ativo },
  });
  res.json(unidade);
}

// ── MEDIDORES ─────────────────────────────────────────────────

async function listarMedidores(req, res) {
  const { unidade_id } = req.query;
  const medidores = await prisma.medidor.findMany({
    where: { ativo: true, ...(unidade_id ? { unidade_id } : {}) },
    include: {
      unidade: {
        select: { id: true, identificador: true, condominio: { select: { id: true, nome: true } } }
      },
      leituras: {
        orderBy: { criado_em: 'desc' },
        take: 1,
        select: { valor: true, criado_em: true, referencia_mes: true, referencia_ano: true },
      },
    },
    orderBy: { criado_em: 'asc' },
  });
  res.json(medidores);
}

async function criarMedidor(req, res) {
  const { unidade_id, tipo, numero_serie, localizacao } = req.body;
  if (!unidade_id) return res.status(400).json({ erro: 'unidade_id é obrigatório.' });
  const medidor = await prisma.medidor.create({
    data: { unidade_id, tipo: tipo || 'AGUA', numero_serie, localizacao },
  });
  res.status(201).json(medidor);
}

async function atualizarMedidor(req, res) {
  const { tipo, numero_serie, localizacao, ativo } = req.body;
  const medidor = await prisma.medidor.update({
    where: { id: req.params.id },
    data: { tipo, numero_serie, localizacao, ativo },
  });
  res.json(medidor);
}

module.exports = { listarUnidades, criarUnidade, atualizarUnidade, listarMedidores, criarMedidor, atualizarMedidor };
