const path   = require('path');
const fs     = require('fs');
const prisma = require('../utils/prisma');
const { analisarImagem } = require('../services/geminiService');

// ── ANALISAR FOTO (sem salvar) ────────────────────────────────
async function analisar(req, res) {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });

  const base64 = req.file.buffer.toString('base64');
  const mime   = req.file.mimetype || 'image/jpeg';

  try {
    const resultado = await analisarImagem(base64, mime);
    res.json(resultado);
  } catch (err) {
    console.error('Erro Gemini:', err.message);
    res.status(502).json({ erro: 'Falha na análise da imagem.', detalhe: err.message });
  }
}

// ── REGISTRAR LEITURA ─────────────────────────────────────────
async function registrar(req, res) {
  const { medidor_id, valor, metodo, confianca, observacoes, referencia_mes, referencia_ano } = req.body;

  if (!medidor_id || valor === undefined || !referencia_mes || !referencia_ano) {
    return res.status(400).json({ erro: 'medidor_id, valor, referencia_mes e referencia_ano são obrigatórios.' });
  }

  // Salva foto localmente se enviada
  let foto_url = null;
  if (req.file) {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    const filename = `${Date.now()}-${req.file.originalname}`;
    fs.writeFileSync(path.join(uploadDir, filename), req.file.buffer);
    foto_url = `/uploads/${filename}`;
  }

  try {
    const leitura = await prisma.leitura.create({
      data: {
        medidor_id,
        user_id: req.user.id,
        valor: parseFloat(valor),
        metodo: metodo || 'MANUAL',
        fonte: 'APP',
        confianca,
        observacoes,
        foto_url,
        referencia_mes: parseInt(referencia_mes),
        referencia_ano: parseInt(referencia_ano),
      },
      include: {
        medidor: { include: { unidade: { select: { identificador: true } } } },
        user: { select: { nome: true } },
      },
    });
    res.status(201).json(leitura);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ erro: 'Já existe uma leitura para este medidor neste mês/ano.' });
    }
    throw err;
  }
}

// ── LISTAR LEITURAS ───────────────────────────────────────────
async function listar(req, res) {
  const { medidor_id, condominio_id, mes, ano } = req.query;

  const leituras = await prisma.leitura.findMany({
    where: {
      ...(medidor_id ? { medidor_id } : {}),
      ...(mes ? { referencia_mes: parseInt(mes) } : {}),
      ...(ano ? { referencia_ano: parseInt(ano) } : {}),
      ...(condominio_id ? {
        medidor: { unidade: { condominio_id } }
      } : {}),
    },
    include: {
      medidor: {
        include: {
          unidade: {
            select: { id: true, identificador: true, andar: true, bloco: true,
              condominio: { select: { id: true, nome: true } } }
          }
        }
      },
      user: { select: { nome: true } },
    },
    orderBy: { criado_em: 'desc' },
  });
  res.json(leituras);
}

// ── DASHBOARD DO DIA ──────────────────────────────────────────
async function dashboard(req, res) {
  const { condominio_id } = req.query;
  const { role, id: userId } = req.user;

  const agora = new Date();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  // Condomínios visíveis para o usuário
  const condominios = await prisma.condominio.findMany({
    where: role === 'ADMIN' ? { ativo: true } : {
      ativo: true,
      gestores: { some: { user_id: userId } }
    },
    ...(condominio_id ? { where: { id: condominio_id } } : {}),
    include: {
      unidades: {
        where: { ativo: true },
        include: {
          medidores: {
            where: { ativo: true },
            include: {
              leituras: {
                where: { referencia_mes: mes, referencia_ano: ano },
                take: 1,
                orderBy: { criado_em: 'desc' },
              }
            }
          }
        }
      }
    }
  });

  const resultado = condominios.map(condo => {
    const totalMedidores = condo.unidades.reduce((acc, u) => acc + u.medidores.length, 0);
    const lidos = condo.unidades.reduce((acc, u) =>
      acc + u.medidores.filter(m => m.leituras.length > 0).length, 0);

    return {
      id: condo.id,
      nome: condo.nome,
      total_medidores: totalMedidores,
      lidos,
      pendentes: totalMedidores - lidos,
      percentual: totalMedidores > 0 ? Math.round((lidos / totalMedidores) * 100) : 0,
    };
  });

  res.json({ mes, ano, condominios: resultado });
}

// ── RELATÓRIO MENSAL ──────────────────────────────────────────
async function relatorio(req, res) {
  const { condominio_id, mes, ano } = req.query;
  if (!condominio_id || !mes || !ano) {
    return res.status(400).json({ erro: 'condominio_id, mes e ano são obrigatórios.' });
  }

  const mesInt = parseInt(mes);
  const anoInt = parseInt(ano);
  const mesAnterior = mesInt === 1 ? 12 : mesInt - 1;
  const anoAnterior = mesInt === 1 ? anoInt - 1 : anoInt;

  const unidades = await prisma.unidade.findMany({
    where: { condominio_id, ativo: true },
    include: {
      medidores: {
        where: { ativo: true },
        include: {
          leituras: {
            where: {
              referencia_ano: { in: [anoInt, anoAnterior] },
              referencia_mes: { in: [mesInt, mesAnterior] },
            },
            orderBy: { criado_em: 'desc' },
          }
        }
      }
    },
    orderBy: { identificador: 'asc' },
  });

  let totalConsumo = 0;
  let totalLidas = 0;
  let totalPendentes = 0;

  const linhas = unidades.map(u => {
    return u.medidores.map(m => {
      const leituraAtual   = m.leituras.find(l => l.referencia_mes === mesInt && l.referencia_ano === anoInt);
      const leituraAnterior = m.leituras.find(l => l.referencia_mes === mesAnterior && l.referencia_ano === anoAnterior);

      const valorAtual    = leituraAtual    ? parseFloat(leituraAtual.valor)    : null;
      const valorAnterior = leituraAnterior ? parseFloat(leituraAnterior.valor) : null;
      const consumo       = valorAtual !== null && valorAnterior !== null ? +(valorAtual - valorAnterior).toFixed(3) : null;
      const variacao      = consumo !== null && valorAnterior > 0
        ? +((consumo / valorAnterior) * 100).toFixed(1) : null;

      if (leituraAtual) { totalLidas++; if (consumo !== null) totalConsumo += consumo; }
      else totalPendentes++;

      return {
        unidade: u.identificador,
        medidor_id: m.id,
        tipo: m.tipo,
        leitura_atual: valorAtual,
        leitura_anterior: valorAnterior,
        consumo,
        variacao_pct: variacao,
        alerta_anomalia: variacao !== null && Math.abs(variacao) > 50,
        data_leitura: leituraAtual?.criado_em || null,
      };
    });
  }).flat();

  // Ranking top consumidores
  const ranking = [...linhas]
    .filter(l => l.consumo !== null)
    .sort((a, b) => b.consumo - a.consumo)
    .slice(0, 10);

  res.json({
    mes: mesInt, ano: anoInt,
    resumo: {
      total_medidores: totalLidas + totalPendentes,
      total_lidas: totalLidas,
      total_pendentes: totalPendentes,
      consumo_total_m3: +totalConsumo.toFixed(3),
      media_consumo_m3: totalLidas > 0 ? +(totalConsumo / totalLidas).toFixed(3) : 0,
    },
    leituras: linhas,
    ranking_consumo: ranking,
  });
}

module.exports = { analisar, registrar, listar, dashboard, relatorio };
