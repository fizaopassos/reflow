const prisma = require('../utils/prisma');
const { gerarCSVPeriodo, gerarCSVMensal, gerarPDFPeriodo, gerarPDFMensal } = require('../services/relatorioService');

// ── VALIDAÇÃO DE ACESSO ──────────────────────────────
async function verificarAcessoCondo(condoId, user) {
  if (user.role === 'ADMIN') return true;
  const vinculo = await prisma.condominioGestor.findUnique({
    where: { condominio_id_user_id: { condominio_id: condoId, user_id: user.id } },
  });
  return !!vinculo;
}

// ── HELPERS ───────────────────────────────────────────
function calcVariacao(atual, anterior) {
  if (anterior === null || anterior === undefined) return null;
  return +(parseFloat(atual) - parseFloat(anterior)).toFixed(3);
}

// ── RELATÓRIO PERÍODO ─────────────────────────────────
async function periodo(req, res) {
  const { condominio_id, data_inicio, data_fim, formato = 'json' } = req.query;
  if (!condominio_id || !data_inicio || !data_fim) {
    return res.status(400).json({ erro: 'condominio_id, data_inicio e data_fim são obrigatórios.' });
  }
  if (!await verificarAcessoCondo(condominio_id, req.user)) {
    return res.status(403).json({ erro: 'Acesso negado a este condomínio.' });
  }

  const inicio = new Date(data_inicio);
  const fim    = new Date(data_fim);

  // Converte datas para inteiro YYYYMMDD para comparação simples
  const toInt = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const inicioInt = toInt(inicio);
  const fimInt    = toInt(fim);

  const { unidade_id } = req.query;

  // Busca todas as leituras do condomínio e filtra em memória por data de referência
  const todasLeituras = await prisma.leitura.findMany({
    where: {
      medidor: {
        unidade: {
          condominio_id,
          ...(unidade_id ? { id: unidade_id } : {}),
        },
      },
    },
    select: {
      id: true,
      medidor_id: true,
      valor: true,
      foto_url: true,
      empresa_snapshot: true,
      metodo: true,
      referencia_dia: true,
      referencia_mes: true,
      referencia_ano: true,
      medidor: {
        select: {
          id: true,
          casas_decimais: true,
          unidade: { select: { identificador: true, bloco: true } },
        },
      },
      user: { select: { nome: true } },
    },
    orderBy: [
      { medidor_id: 'asc' },
      { referencia_ano: 'asc' },
      { referencia_mes: 'asc' },
      { referencia_dia: 'asc' },
    ],
  });

  // Filtra pelo período usando referencia (não criado_em)
  const leituras = todasLeituras.filter(l => {
    const dataInt = l.referencia_ano * 10000 + l.referencia_mes * 100 + l.referencia_dia;
    return dataInt >= inicioInt && dataInt <= fimInt;
  });

  // Calcula variação diária e alerta
  const THRESHOLD = parseFloat(req.query.threshold || '50'); // % de variação para alerta
  const linhas = [];
  const ultimoPorMedidor = {};

  leituras.forEach(l => {
    const anterior = ultimoPorMedidor[l.medidor_id] ?? null;
    const variacao = calcVariacao(l.valor, anterior);
    const media    = anterior !== null ? parseFloat(anterior) : null;
    const varPct   = media && media > 0 ? ((variacao / media) * 100) : null;
    const alerta   = varPct !== null && Math.abs(varPct) > THRESHOLD;

    const casas = l.medidor.casas_decimais ?? 3;
    linhas.push({
      medidor_id:       l.medidor_id,
      unidade:          l.medidor.unidade.identificador,
      bloco:            l.medidor.unidade.bloco,
      empresa_snapshot: l.empresa_snapshot,
      casas_decimais:   casas,
      referencia_dia:   l.referencia_dia,
      referencia_mes:   l.referencia_mes,
      referencia_ano:   l.referencia_ano,
      valor:            parseFloat(l.valor),
      variacao,
      variacao_pct:     varPct ? +varPct.toFixed(1) : null,
      alerta,
      leitor:           l.user.nome,
      metodo:           l.metodo,
      foto_url:         l.foto_url,
      criado_em:        l.criado_em,
    });

    ultimoPorMedidor[l.medidor_id] = l.valor;
  });

  const condo = await prisma.condominio.findUnique({ where: { id: condominio_id }, select: { nome: true } });

  // Acumulado por medidor no período
  const acumuladoPorMedidor = {};
  linhas.forEach(l => {
    if (!acumuladoPorMedidor[l.medidor_id]) {
      acumuladoPorMedidor[l.medidor_id] = {
        unidade: l.unidade, bloco: l.bloco, empresa: l.empresa_snapshot,
        casas_decimais: l.casas_decimais, consumo: 0
      };
    }
    if (l.variacao !== null && l.variacao > 0) {
      acumuladoPorMedidor[l.medidor_id].consumo += l.variacao;
    }
  });
  const acumulado = Object.values(acumuladoPorMedidor).map(a => ({
    ...a, consumo: +a.consumo.toFixed(a.casas_decimais)
  })).sort((a, b) => b.consumo - a.consumo);
  const consumoTotalPeriodo = +acumulado.reduce((s, a) => s + a.consumo, 0).toFixed(3);

  const resumo = {
    total_leituras:      linhas.length,
    total_alertas:       linhas.filter(l => l.alerta).length,
    consumo_total_m3:    consumoTotalPeriodo,
    medidores_com_dados: acumulado.length,
  };

  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leituras-periodo.csv"');
    return res.send('\uFEFF' + gerarCSVPeriodo(linhas));
  }

  if (formato === 'pdf') {
    return gerarPDFPeriodo(linhas, { condominio: condo?.nome || '', dataInicio: inicio, dataFim: fim }, res, acumulado, resumo);
  }

  res.json({ condominio: condo?.nome, data_inicio, data_fim, resumo, acumulado, leituras: linhas });
}

// ── RELATÓRIO MENSAL acumulado ────────────────────────
async function mensal(req, res) {
  const { condominio_id, mes, ano, formato = 'json' } = req.query;
  if (!condominio_id || !mes || !ano) {
    return res.status(400).json({ erro: 'condominio_id, mes e ano são obrigatórios.' });
  }
  if (!await verificarAcessoCondo(condominio_id, req.user)) {
    return res.status(403).json({ erro: 'Acesso negado a este condomínio.' });
  }

  const mesInt = parseInt(mes);
  const anoInt = parseInt(ano);
  const THRESHOLD = parseFloat(req.query.threshold || '50');

  const leituras = await prisma.leitura.findMany({
    where: {
      referencia_mes: mesInt,
      referencia_ano: anoInt,
      medidor: { unidade: { condominio_id } },
    },
    include: {
      medidor: { include: { unidade: { select: { identificador: true, bloco: true, empresa: true } } } },
      user: { select: { nome: true } },
    },
    orderBy: [{ medidor_id: 'asc' }, { referencia_dia: 'asc' }],
  });

  // Agrupa por medidor e calcula acumulado (soma variações diárias)
  const porMedidor = {};
  leituras.forEach(l => {
    const mid = l.medidor_id;
    if (!porMedidor[mid]) {
      porMedidor[mid] = {
        unidade:         l.medidor.unidade.identificador,
        bloco:           l.medidor.unidade.bloco,
        empresa:         l.medidor.unidade.empresa,
        leituras_ord:    [],
      };
    }
    porMedidor[mid].leituras_ord.push(parseFloat(l.valor));
  });

  let totalConsumo = 0;
  const linhas = Object.entries(porMedidor).map(([medidor_id, data]) => {
    const vals = data.leituras_ord;
    // Soma das variações diárias
    let consumo = 0;
    for (let i = 1; i < vals.length; i++) {
      const diff = vals[i] - vals[i-1];
      if (diff > 0) consumo += diff;
    }
    consumo = +consumo.toFixed(3);
    totalConsumo += consumo;

    const primeira = vals[0];
    const ultima   = vals[vals.length - 1];

    // Variação % em relação ao mês anterior (simplificado: consumo vs média)
    const varPct = primeira > 0 ? +((consumo / primeira) * 100).toFixed(1) : null;
    const alerta = varPct !== null && varPct > THRESHOLD;

    return {
      medidor_id,
      unidade:         data.unidade,
      bloco:           data.bloco,
      empresa:         data.empresa,
      dias_lidos:      vals.length,
      primeira_leitura: primeira,
      ultima_leitura:   ultima,
      consumo_m3:       consumo,
      variacao_pct:     varPct,
      alerta,
    };
  }).sort((a, b) => b.consumo_m3 - a.consumo_m3);

  const resumo = {
    total_medidores_lidos: linhas.length,
    consumo_total_m3:      +totalConsumo.toFixed(3),
    media_consumo_m3:      linhas.length > 0 ? +(totalConsumo / linhas.length).toFixed(3) : 0,
    total_alertas:         linhas.filter(l => l.alerta).length,
  };

  const condo = await prisma.condominio.findUnique({ where: { id: condominio_id }, select: { nome: true } });

  // Acumulado por medidor no período
  const acumuladoPorMedidor = {};
  linhas.forEach(l => {
    if (!acumuladoPorMedidor[l.medidor_id]) {
      acumuladoPorMedidor[l.medidor_id] = {
        unidade: l.unidade, bloco: l.bloco, empresa: l.empresa_snapshot,
        casas_decimais: l.casas_decimais, consumo: 0
      };
    }
    if (l.variacao !== null && l.variacao > 0) {
      acumuladoPorMedidor[l.medidor_id].consumo += l.variacao;
    }
  });
  const acumulado = Object.values(acumuladoPorMedidor).map(a => ({
    ...a, consumo: +a.consumo.toFixed(a.casas_decimais)
  })).sort((a, b) => b.consumo - a.consumo);
  const consumoTotalPeriodo = +acumulado.reduce((s, a) => s + a.consumo, 0).toFixed(3);

  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="acumulado-${mes}-${ano}.csv"`);
    return res.send('\uFEFF' + gerarCSVMensal(linhas, mesInt, anoInt));
  }

  if (formato === 'pdf') {
    return gerarPDFMensal(linhas, resumo, { condominio: condo?.nome || '', mes: mesInt, ano: anoInt }, res);
  }

  res.json({ condominio: condo?.nome, mes: mesInt, ano: anoInt, resumo, leituras: linhas });
}

// ── ALERTAS ───────────────────────────────────────────
async function alertas(req, res) {
  const { condominio_id, threshold = '50' } = req.query;
  if (!condominio_id) return res.status(400).json({ erro: 'condominio_id é obrigatório.' });

  const THRESHOLD = parseFloat(threshold);
  const agora = new Date();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  const leituras = await prisma.leitura.findMany({
    where: { referencia_mes: mes, referencia_ano: ano, medidor: { unidade: { condominio_id } } },
    include: { medidor: { include: { unidade: { select: { identificador: true, bloco: true } } } } },
    orderBy: [{ medidor_id: 'asc' }, { referencia_dia: 'asc' }],
  });

  const porMedidor = {};
  leituras.forEach(l => {
    if (!porMedidor[l.medidor_id]) porMedidor[l.medidor_id] = { unidade: l.medidor.unidade, vals: [] };
    porMedidor[l.medidor_id].vals.push({ dia: l.referencia_dia, valor: parseFloat(l.valor) });
  });

  const alertasEncontrados = [];
  Object.entries(porMedidor).forEach(([mid, data]) => {
    for (let i = 1; i < data.vals.length; i++) {
      const diff    = data.vals[i].valor - data.vals[i-1].valor;
      const base    = data.vals[i-1].valor;
      const varPct  = base > 0 ? (diff / base) * 100 : 0;
      if (Math.abs(varPct) > THRESHOLD) {
        alertasEncontrados.push({
          medidor_id:  mid,
          unidade:     data.vals[i-1] && (data.unidade.bloco ? data.unidade.bloco + ' · ' : '') + data.unidade.identificador,
          dia:         data.vals[i].dia,
          valor_atual: data.vals[i].valor,
          valor_ant:   data.vals[i-1].valor,
          variacao_m3: +diff.toFixed(3),
          variacao_pct: +varPct.toFixed(1),
        });
      }
    }
  });

  res.json({ mes, ano, threshold: THRESHOLD, alertas: alertasEncontrados });
}

// ── EXTRATO POR UNIDADE ──────────────────────────────
async function extrato(req, res) {
  const { condominio_id, mes, ano, unidade_id, formato = 'json' } = req.query;
  if (!condominio_id || !mes || !ano) {
    return res.status(400).json({ erro: 'condominio_id, mes e ano são obrigatórios.' });
  }
  if (!await verificarAcessoCondo(condominio_id, req.user)) {
    return res.status(403).json({ erro: 'Acesso negado a este condomínio.' });
  }

  const mesInt = parseInt(mes);
  const anoInt = parseInt(ano);

  // Dias do mês
  const diasNoMes = new Date(anoInt, mesInt, 0).getDate();
  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  // Busca medidores do condomínio (filtra por unidade se informada)
  const medidores = await prisma.medidor.findMany({
    where: {
      ativo: true,
      unidade: {
        condominio_id,
        ativo: true,
        ...(unidade_id ? { id: unidade_id } : {}),
      },
    },
    include: {
      unidade: { select: { id: true, identificador: true, bloco: true, empresa: true } },
      leituras: {
        where: { referencia_mes: mesInt, referencia_ano: anoInt },
        include: { user: { select: { nome: true } } },
        orderBy: { referencia_dia: 'asc' },
      },
    },
    orderBy: [{ unidade: { bloco: 'asc' } }, { unidade: { identificador: 'asc' } }],
  });

  const condo = await prisma.condominio.findUnique({
    where: { id: condominio_id }, select: { nome: true }
  });

  // Monta extrato por medidor
  const extratos = medidores.map(m => {
    const leiturasMap = {};
    m.leituras.forEach(l => { leiturasMap[l.referencia_dia] = l; });

    let consumoTotal = 0;
    let valorAnterior = null;
    const linhas = [];

    for (let d = 1; d <= diasNoMes; d++) {
      const leitura = leiturasMap[d];
      const diaSemana = diasSemana[new Date(anoInt, mesInt - 1, d).getDay()];
      const dataStr = String(d).padStart(2,'0') + '/' + String(mesInt).padStart(2,'0') + '/' + anoInt;

      if (leitura) {
        const valor = parseFloat(leitura.valor);
        const consumo = valorAnterior !== null ? +(valor - valorAnterior).toFixed(3) : null;
        if (consumo !== null && consumo > 0) consumoTotal += consumo;
        valorAnterior = valor;
        linhas.push({
          dia: d, data: dataStr, dia_semana: diaSemana,
          valor, consumo, leitor: leitura.user.nome,
          foto_url: leitura.foto_url, tem_foto: !!leitura.foto_url,
          sem_leitura: false,
        });
      } else {
        linhas.push({
          dia: d, data: dataStr, dia_semana: diaSemana,
          valor: null, consumo: null, leitor: null,
          foto_url: null, tem_foto: false,
          sem_leitura: true,
        });
      }
    }

    return {
      medidor_id: m.id,
      unidade: m.unidade.identificador,
      bloco: m.unidade.bloco,
      empresa: m.unidade.empresa,
      tipo: m.tipo,
      numero_serie: m.numero_serie,
      casas_decimais: m.casas_decimais,
      consumo_total: +consumoTotal.toFixed(m.casas_decimais),
      dias_lidos: m.leituras.length,
      linhas,
    };
  });

  if (formato === 'csv') {
    const { gerarCSVExtrato } = require('../services/relatorioService');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="extrato-${mes}-${ano}.csv"`);
    return res.send('﻿' + gerarCSVExtrato(extratos, mesInt, anoInt));
  }

  if (formato === 'pdf') {
    const { gerarPDFExtrato } = require('../services/relatorioService');
    return gerarPDFExtrato(extratos, { condominio: condo?.nome || '', mes: mesInt, ano: anoInt }, res);
  }

  res.json({ condominio: condo?.nome, mes: mesInt, ano: anoInt, extratos });
}

module.exports = { periodo, mensal, alertas, extrato };
