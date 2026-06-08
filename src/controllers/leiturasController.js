const path   = require('path');
const fs     = require('fs');
const prisma = require('../utils/prisma');
const { analisarImagem } = require('../services/geminiService');
const { interpretarInput } = require('../utils/formatacao');
const { uploadFoto } = require('../services/storageService');

// ── ANALISAR FOTO (sem salvar) ────────────────────────
async function analisar(req, res) {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });
  try {
    const resultado = await analisarImagem(
      req.file.buffer.toString('base64'),
      req.file.mimetype || 'image/jpeg'
    );
    res.json(resultado);
  } catch (err) {
    console.error('Erro Gemini:', err.message);
    res.status(502).json({ erro: 'Falha na análise da imagem.', detalhe: err.message });
  }
}

// ── REGISTRAR LEITURA ─────────────────────────────────
async function registrar(req, res) {
  const { medidor_id, valor, metodo, confianca, observacoes,
          referencia_dia, referencia_mes, referencia_ano } = req.body;

  if (!medidor_id || valor === undefined || !referencia_dia || !referencia_mes || !referencia_ano) {
    return res.status(400).json({ erro: 'medidor_id, valor, referencia_dia, referencia_mes e referencia_ano são obrigatórios.' });
  }

  const medidorCasas = await prisma.medidor.findUnique({
    where: { id: medidor_id },
    select: { casas_decimais: true },
  });
  const casasDecimais = medidorCasas?.casas_decimais ?? 3;

  const valorNum = interpretarInput(valor, casasDecimais);
  if (isNaN(valorNum) || valorNum < 0) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }
  if (valorNum >= 99999999) {
    return res.status(400).json({ erro: 'Valor muito alto. Verifique se não digitou errado.' });
  }

  const { formatarValor } = require('../utils/formatacao');
  const diaRef = parseInt(referencia_dia), mesRef = parseInt(referencia_mes), anoRef = parseInt(referencia_ano);

  const leituraAnterior = await prisma.leitura.findFirst({
    where: {
      medidor_id,
      OR: [
        { referencia_ano: { lt: anoRef } },
        { referencia_ano: anoRef, referencia_mes: { lt: mesRef } },
        { referencia_ano: anoRef, referencia_mes: mesRef, referencia_dia: { lt: diaRef } },
      ],
    },
    orderBy: [
      { referencia_ano: 'desc' },
      { referencia_mes: 'desc' },
      { referencia_dia: 'desc' },
    ],
  });

  if (leituraAnterior && valorNum < parseFloat(leituraAnterior.valor)) {
    return res.status(400).json({
      erro: `Valor menor que a leitura do dia anterior (${formatarValor(leituraAnterior.valor, casasDecimais)} em ${String(leituraAnterior.referencia_dia).padStart(2,'0')}/${String(leituraAnterior.referencia_mes).padStart(2,'0')}/${leituraAnterior.referencia_ano}).`
    });
  }

  const medidorInfo = await prisma.medidor.findUnique({
    where: { id: medidor_id },
    include: { unidade: { select: { empresa: true } } },
  });
  const empresa_snapshot = medidorInfo?.unidade?.empresa || null;

    let foto_url = null;
  if (req.file) {
    try {
      const caminho = await uploadFoto(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );
      foto_url = caminho;
      console.log('[GCS] Upload ok:', caminho);
    } catch (err) {
      console.error('[GCS] Erro no upload:', err.message);
      return res.status(500).json({ erro: 'Falha ao salvar foto.', detalhe: err.message });
    }
  }

  try {
    const leitura = await prisma.leitura.create({
      data: {
        medidor_id,
        user_id: req.user.id,
        valor: valorNum,
        empresa_snapshot,
        metodo: metodo || 'MANUAL',
        fonte: 'APP',
        confianca,
        observacoes,
        foto_url,
        referencia_dia: parseInt(referencia_dia),
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
      return res.status(409).json({ erro: 'Já existe uma leitura para este medidor neste dia.' });
    }
    throw err;
  }
}

// ── EDITAR LEITURA (GESTOR/ADMIN apenas) ─────────────
async function editar(req, res) {
  const { valor, observacoes, metodo, referencia_dia, referencia_mes, referencia_ano } = req.body;
  const { id } = req.params;

  const leitura = await prisma.leitura.findUnique({ where: { id } });
  if (!leitura) return res.status(404).json({ erro: 'Leitura não encontrada.' });

  if (referencia_dia && referencia_mes && referencia_ano) {
    const diaInt = parseInt(referencia_dia), mesInt = parseInt(referencia_mes), anoInt = parseInt(referencia_ano);
    if (diaInt !== leitura.referencia_dia || mesInt !== leitura.referencia_mes || anoInt !== leitura.referencia_ano) {
      const existe = await prisma.leitura.findUnique({
        where: { medidor_id_referencia_dia_referencia_mes_referencia_ano: {
          medidor_id: leitura.medidor_id, referencia_dia: diaInt, referencia_mes: mesInt, referencia_ano: anoInt
        }}
      });
      if (existe) return res.status(409).json({ erro: 'Já existe uma leitura nessa data para este medidor.' });
    }
  }

  let valorFinal = undefined;
  if (valor !== undefined) {
    const med = await prisma.medidor.findUnique({ where: { id: leitura.medidor_id }, select: { casas_decimais: true } });
    const { interpretarInput, formatarValor } = require('../utils/formatacao');
    valorFinal = interpretarInput(valor, med?.casas_decimais ?? 3);
    const casas = med?.casas_decimais ?? 3;

    const diaVal = referencia_dia ? parseInt(referencia_dia) : leitura.referencia_dia;
    const mesVal = referencia_mes ? parseInt(referencia_mes) : leitura.referencia_mes;
    const anoVal = referencia_ano ? parseInt(referencia_ano) : leitura.referencia_ano;

    const anterior = await prisma.leitura.findFirst({
      where: { medidor_id: leitura.medidor_id, id: { not: id },
        OR: [
          { referencia_ano: { lt: anoVal } },
          { referencia_ano: anoVal, referencia_mes: { lt: mesVal } },
          { referencia_ano: anoVal, referencia_mes: mesVal, referencia_dia: { lt: diaVal } },
        ],
      },
      orderBy: [{ referencia_ano: 'desc' }, { referencia_mes: 'desc' }, { referencia_dia: 'desc' }],
    });
    if (anterior && valorFinal < parseFloat(anterior.valor)) {
      return res.status(400).json({
        erro: `Valor menor que a leitura anterior (${formatarValor(anterior.valor, casas)} em ${String(anterior.referencia_dia).padStart(2,'0')}/${String(anterior.referencia_mes).padStart(2,'0')}).`
      });
    }
  }

  const data = {
    observacoes,
    metodo,
    editado_por_id: req.user.id,
  };
  if (valorFinal !== undefined) data.valor = valorFinal;
  if (referencia_dia) data.referencia_dia = parseInt(referencia_dia);
  if (referencia_mes) data.referencia_mes = parseInt(referencia_mes);
  if (referencia_ano) data.referencia_ano = parseInt(referencia_ano);

  const atualizada = await prisma.leitura.update({
    where: { id },
    data,
    include: {
      medidor: { include: { unidade: { select: { identificador: true } } } },
      user:        { select: { nome: true } },
      editado_por: { select: { nome: true } },
    },
  });
  res.json(atualizada);
}

// ── DELETAR LEITURA (GESTOR/ADMIN apenas) ─────────────
async function deletar(req, res) {
  const { id } = req.params;

  const leitura = await prisma.leitura.findUnique({
    where: { id },
    include: {
      medidor: {
        include: {
          unidade: { select: { condominio_id: true } }
        }
      }
    }
  });

  if (!leitura) {
    return res.status(404).json({ erro: 'Leitura não encontrada.' });
  }

  // GESTOR só pode excluir leituras do seu condomínio
  if (req.user.role === 'GESTOR') {
    const condoId = leitura.medidor.unidade.condominio_id;
    const vinculo = await prisma.condominioGestor.findUnique({
      where: {
        condominio_id_user_id: {
          condominio_id: condoId,
          user_id: req.user.id,
        }
      }
    });
    if (!vinculo) {
      return res.status(403).json({ erro: 'Sem permissão para excluir leitura deste condomínio.' });
    }
  }

  // Remove o arquivo de foto do disco se existir
  if (leitura.foto_url) {
    try {
      const filepath = path.join(__dirname, '../../', leitura.foto_url);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    } catch (e) {
      console.warn('[deletar] Não foi possível remover a foto:', e.message);
    }
  }

  await prisma.leitura.delete({ where: { id } });

  res.json({ ok: true, mensagem: 'Leitura excluída com sucesso.' });
}

// ── LISTAR LEITURAS ───────────────────────────────────
async function listar(req, res) {
  const { medidor_id, condominio_id, dia, mes, ano } = req.query;

  const leituras = await prisma.leitura.findMany({
    where: {
      ...(medidor_id    ? { medidor_id }                       : {}),
      ...(dia           ? { referencia_dia: parseInt(dia) }    : {}),
      ...(mes           ? { referencia_mes: parseInt(mes) }    : {}),
      ...(ano           ? { referencia_ano: parseInt(ano) }    : {}),
      ...(condominio_id ? { medidor: { unidade: { condominio_id } } } : {}),
    },
    include: {
      medidor: {
        include: {
          unidade: {
            select: {
              id: true, identificador: true, bloco: true, empresa: true,
              condominio: { select: { id: true, nome: true } }
            }
          }
        }
      },
      user:        { select: { nome: true } },
      editado_por: { select: { nome: true } },
    },
    orderBy: [
      { referencia_ano: 'desc' },
      { referencia_mes: 'desc' },
      { referencia_dia: 'desc' },
    ],
  });
  res.json(leituras);
}

// ── BUSCAR LEITURA DO DIA ─────────────────────────────
async function buscarDia(req, res) {
  const { medidor_id } = req.params;
  const agora = new Date();

  const leitura = await prisma.leitura.findUnique({
    where: {
      medidor_id_referencia_dia_referencia_mes_referencia_ano: {
        medidor_id,
        referencia_dia: agora.getDate(),
        referencia_mes: agora.getMonth() + 1,
        referencia_ano: agora.getFullYear(),
      }
    },
    include: {
      user:        { select: { nome: true } },
      editado_por: { select: { nome: true } },
    },
  });

  res.json(leitura || null);
}

// ── DASHBOARD DO DIA ──────────────────────────────────
async function dashboard(req, res) {
  const { condominio_id } = req.query;
  const { role, id: userId } = req.user;
  const agora = new Date();
  const dia = agora.getDate();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  let whereRole = { ativo: true };
  if (role === 'GESTOR') whereRole.gestores = { some: { user_id: userId } };
  if (role === 'LEITOR') whereRole.leitores = { some: { user_id: userId } };
  if (condominio_id) whereRole.id = condominio_id;

  const condominios = await prisma.condominio.findMany({
    where: whereRole,
    include: {
      unidades: {
        where: { ativo: true },
        include: {
          medidores: {
            where: { ativo: true },
            include: {
              leituras: {
                where: { referencia_dia: dia, referencia_mes: mes, referencia_ano: ano },
                take: 1,
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

  res.json({ dia, mes, ano, condominios: resultado });
}

// ── RELATÓRIO ─────────────────────────────────────────
async function relatorio(req, res) {
  const { condominio_id, mes, ano, tipo = 'mensal' } = req.query;
  if (!condominio_id || !mes || !ano) {
    return res.status(400).json({ erro: 'condominio_id, mes e ano são obrigatórios.' });
  }

  const mesInt = parseInt(mes);
  const anoInt = parseInt(ano);

  const leituras = await prisma.leitura.findMany({
    where: {
      referencia_mes: mesInt,
      referencia_ano: anoInt,
      medidor: { unidade: { condominio_id } },
    },
    include: {
      medidor: {
        include: {
          unidade: { select: { identificador: true, bloco: true, empresa: true } }
        }
      },
      user: { select: { nome: true } },
    },
    orderBy: [
      { medidor_id: 'asc' },
      { referencia_dia: 'asc' },
    ],
  });

  if (tipo === 'diario') {
    const porDia = {};
    leituras.forEach(l => {
      const key = l.referencia_dia;
      if (!porDia[key]) porDia[key] = [];
      porDia[key].push({
        unidade: l.medidor.unidade.identificador,
        medidor_id: l.medidor_id,
        valor: parseFloat(l.valor),
        metodo: l.metodo,
        leitor: l.user.nome,
        hora: l.criado_em,
      });
    });
    return res.json({ mes: mesInt, ano: anoInt, tipo: 'diario', dias: porDia });
  }

  const porMedidor = {};
  leituras.forEach(l => {
    if (!porMedidor[l.medidor_id]) {
      porMedidor[l.medidor_id] = {
        unidade: l.medidor.unidade.identificador,
        bloco: l.medidor.unidade.bloco,
        empresa: l.medidor.unidade.empresa,
        leituras: [],
      };
    }
    porMedidor[l.medidor_id].leituras.push(parseFloat(l.valor));
  });

  let totalConsumo = 0;
  const linhas = Object.entries(porMedidor).map(([medidor_id, data]) => {
    const primeira = data.leituras[0];
    const ultima   = data.leituras[data.leituras.length - 1];
    const consumo  = +(ultima - primeira).toFixed(3);
    totalConsumo += consumo > 0 ? consumo : 0;
    return {
      unidade: data.unidade,
      bloco: data.bloco,
      empresa: data.empresa,
      medidor_id,
      primeira_leitura: primeira,
      ultima_leitura: ultima,
      dias_lidos: data.leituras.length,
      consumo_m3: consumo,
    };
  });

  const ranking = [...linhas].sort((a, b) => b.consumo_m3 - a.consumo_m3).slice(0, 10);

  res.json({
    mes: mesInt, ano: anoInt, tipo: 'mensal',
    resumo: {
      total_medidores_lidos: linhas.length,
      consumo_total_m3: +totalConsumo.toFixed(3),
      media_consumo_m3: linhas.length > 0 ? +(totalConsumo / linhas.length).toFixed(3) : 0,
    },
    leituras: linhas,
    ranking_consumo: ranking,
  });
}

module.exports = { analisar, registrar, editar, deletar, listar, buscarDia, dashboard, relatorio };
