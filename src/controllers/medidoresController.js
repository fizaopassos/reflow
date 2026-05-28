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
  const { condominio_id, identificador, bloco, empresa } = req.body;
  if (!condominio_id || !identificador) {
    return res.status(400).json({ erro: 'condominio_id e identificador são obrigatórios.' });
  }
  const unidade = await prisma.unidade.create({
    data: { condominio_id, identificador, bloco, empresa },
  });
  res.status(201).json(unidade);
}

async function atualizarUnidade(req, res) {
  const { identificador, bloco, empresa, ativo } = req.body;
  const unidade = await prisma.unidade.update({
    where: { id: req.params.id },
    data: { identificador, bloco, empresa, ativo },
  });
  res.json(unidade);
}

// ── MEDIDORES ─────────────────────────────────────────────────

async function listarMedidores(req, res) {
  const { unidade_id, condominio_id } = req.query;
  const medidores = await prisma.medidor.findMany({
    where: {
      ativo: true,
      ...(unidade_id    ? { unidade_id }                              : {}),
      ...(condominio_id ? { unidade: { condominio_id } }              : {}),
    },
    include: {
      unidade: {
        select: {
          id: true, identificador: true, bloco: true, empresa: true,
          condominio: { select: { id: true, nome: true } }
        }
      },
      leituras: {
        orderBy: { criado_em: 'desc' },
        take: 1,
        select: { valor: true, criado_em: true, referencia_dia: true, referencia_mes: true, referencia_ano: true },
      },
    },
    orderBy: [{ unidade: { identificador: 'asc' } }],
  });
  res.json(medidores);
}

async function criarMedidor(req, res) {
  const { unidade_id, tipo, numero_serie, localizacao, casas_decimais } = req.body;
  if (!unidade_id) return res.status(400).json({ erro: 'unidade_id é obrigatório.' });
  const medidor = await prisma.medidor.create({
    data: {
      unidade_id, tipo: tipo || 'AGUA', numero_serie, localizacao,
      casas_decimais: casas_decimais !== undefined ? parseInt(casas_decimais) : 3,
    },
  });
  res.status(201).json(medidor);
}

async function atualizarMedidor(req, res) {
  const { tipo, numero_serie, localizacao, casas_decimais, ativo } = req.body;
  const data = { tipo, numero_serie, localizacao, ativo };
  if (casas_decimais !== undefined) data.casas_decimais = parseInt(casas_decimais);
  const medidor = await prisma.medidor.update({
    where: { id: req.params.id },
    data,
  });
  res.json(medidor);
}

async function buscarMedidor(req, res) {
  const medidor = await prisma.medidor.findUnique({
    where: { id: req.params.id },
    select: { id: true, tipo: true, numero_serie: true, casas_decimais: true, localizacao: true },
  });
  if (!medidor) return res.status(404).json({ erro: 'Medidor não encontrado.' });
  res.json(medidor);
}

module.exports = { listarUnidades, criarUnidade, atualizarUnidade, listarMedidores, buscarMedidor, criarMedidor, atualizarMedidor };
