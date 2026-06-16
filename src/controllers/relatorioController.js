const prisma = require('../utils/prisma');
const { gerarCSVPeriodo, gerarCSVMensal, gerarPDFPeriodo, gerarPDFMensal } = require('../services/relatorioService');
const { gerarGraficoBarras } = require('../services/graficoService');

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

function maxCasas(linhas, campo = 'casas_decimais') {
  if (!linhas || !linhas.length) return 2;
  return linhas.reduce((max, l) => Math.max(max, l[campo] ?? 2), 0);
}

function isGeral(empresa) {
  if (!empresa) return true;
  const norm = empresa.trim().toLowerCase();
  return norm === 'geral' || norm === 'área comum' || norm === 'area comum';
}

function calcAreaComum(linhas, campoConsumo = 'consumo_m3') {
  const gerais     = linhas.filter(l => isGeral(l.empresa));
  const privativos = linhas.filter(l => !isGeral(l.empresa));

  if (!gerais.length) return null;

  const casas        = maxCasas(linhas);
  const consumoGeral = +gerais    .reduce((s, l) => s + (l[campoConsumo] || 0), 0).toFixed(casas);
  const consumoPriv  = +privativos.reduce((s, l) => s + (l[campoConsumo] || 0), 0).toFixed(casas);
  const consumoComum = +(consumoGeral - consumoPriv).toFixed(casas);

  return {
    consumo_geral:      consumoGeral,
    consumo_privativo:  consumoPriv,
    consumo_area_comum: consumoComum,
    negativo:           consumoComum < 0,
    casas_decimais:     casas,
  };
}

function labelUnidade(bloco, identificador, empresa) {
  const unid = (bloco ? bloco + identificador : identificador);
  return (unid + (empresa ? ' — ' + empresa : '')).trim();
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

  const [iniA, iniM, iniD] = data_inicio.split('-').map(Number);
  const [fimA, fimM, fimD] = data_fim.split('-').map(Number);
  const inicioInt = iniA * 10000 + iniM * 100 + iniD;
  const fimInt    = fimA * 10000 + fimM * 100 + fimD;

  const inicioDate = new Date(data_inicio + 'T12:00:00');
  const fimDate    = new Date(data_fim    + 'T12:00:00');

  const { unidade_id } = req.query;

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

  const leituras = todasLeituras.filter(l => {
    const dataInt = l.referencia_ano * 10000 + l.referencia_mes * 100 + l.referencia_dia;
    return dataInt >= inicioInt && dataInt <= fimInt;
  });

  const THRESHOLD = parseFloat(req.query.threshold || '20');
  const linhas = [];
  const ultimoPorMedidor = {};
  const alertaPorMedidor = {};

  leituras.forEach(l => {
    const anterior = ultimoPorMedidor[l.medidor_id] ?? null;
    const variacao = calcVariacao(l.valor, anterior);
    const media    = anterior !== null ? parseFloat(anterior) : null;
    const varPct   = media && media > 0 ? ((variacao / media) * 100) : null;
    const alerta   = varPct !== null && Math.abs(varPct) > THRESHOLD;

    if (alerta) alertaPorMedidor[l.medidor_id] = true;

    const casas = l.medidor.casas_decimais ?? 2;
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

  const primeiraLeituraPorMedidor = {};
  const ultimaLeituraPorMedidor   = {};

  leituras.forEach(l => {
    const v = parseFloat(l.valor);
    if (primeiraLeituraPorMedidor[l.medidor_id] === undefined) {
      primeiraLeituraPorMedidor[l.medidor_id] = v;
    }
    ultimaLeituraPorMedidor[l.medidor_id] = v;
  });

  const acumuladoPorMedidor = {};
  leituras.forEach(l => {
    if (!acumuladoPorMedidor[l.medidor_id]) {
      const casas    = l.medidor.casas_decimais ?? 2;
      const primeira = primeiraLeituraPorMedidor[l.medidor_id];
      const ultima   = ultimaLeituraPorMedidor[l.medidor_id];
      const consumo  = +(ultima - primeira).toFixed(casas);
      acumuladoPorMedidor[l.medidor_id] = {
        unidade:        l.medidor.unidade.identificador,
        bloco:          l.medidor.unidade.bloco,
        empresa:        l.empresa_snapshot,
        casas_decimais: casas,
        consumo:        consumo > 0 ? consumo : 0,
        alerta:         !!alertaPorMedidor[l.medidor_id],
      };
    }
  });

  const acumulado = Object.values(acumuladoPorMedidor)
    .sort((a, b) => b.consumo - a.consumo);

  const casasTotal = maxCasas(acumulado);
  const consumoTotalPeriodo = +acumulado
    .reduce((s, a) => s + a.consumo, 0)
    .toFixed(casasTotal);

  const resumo = {
    total_leituras:      linhas.length,
    total_alertas:       linhas.filter(l => l.alerta).length,
    consumo_total_m3:    consumoTotalPeriodo,
    medidores_com_dados: acumulado.length,
    casas_decimais:      casasTotal,
  };

  const areaComum = calcAreaComum(
    acumulado.map(a => ({ ...a, consumo_m3: a.consumo }))
  );

  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="leituras-periodo.csv"');
    return res.send('\uFEFF' + gerarCSVPeriodo(linhas));
  }

  if (formato === 'pdf') {
    let graficoBuffer = null;
    if (acumulado && acumulado.length > 0) {
      try {
        const dadosGrafico = acumulado.map(a => ({
          label:   labelUnidade(a.bloco, a.unidade, a.empresa),
          consumo: a.consumo,
        }));
        graficoBuffer = await gerarGraficoBarras(dadosGrafico, 'm³', 'Consumo por unidade no período');
      } catch (e) {
        console.warn('[PDF] Não foi possível gerar gráfico:', e.message);
      }
    }
    return gerarPDFPeriodo(linhas, { condominio: condo?.nome || '', dataInicio: inicioDate, dataFim: fimDate }, res, acumulado, resumo, graficoBuffer);
  }

  res.json({ condominio: condo?.nome, data_inicio, data_fim, resumo, area_comum: areaComum, acumulado, leituras: linhas });
}

// ── RELATÓRIO MENSAL ──────────────────────────────────
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
  const THRESHOLD = parseFloat(req.query.threshold || '20');

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

  const porMedidor = {};
  leituras.forEach(l => {
    const mid = l.medidor_id;
    if (!porMedidor[mid]) {
      porMedidor[mid] = {
        unidade:      l.medidor.unidade.identificador,
        bloco:        l.medidor.unidade.bloco,
        empresa:      l.medidor.unidade.empresa,
        casas:        l.medidor.casas_decimais ?? 2,
        leituras_ord: [],
      };
    }
    porMedidor[mid].leituras_ord.push(parseFloat(l.valor));
  });

  let totalConsumo = 0;
  const linhas = Object.entries(porMedidor).map(([medidor_id, data]) => {
    const vals     = data.leituras_ord;
    const primeira = vals[0];
    const ultima   = vals[vals.length - 1];
    const consumo  = +Math.max(0, ultima - primeira).toFixed(data.casas);
    totalConsumo  += consumo;

    const varPct = primeira > 0 ? +((consumo / primeira) * 100).toFixed(1) : null;
    const alerta = varPct !== null && varPct > THRESHOLD;

    return {
      medidor_id,
      unidade:          data.unidade,
      bloco:            data.bloco,
      empresa:          data.empresa,
      casas_decimais:   data.casas,
      dias_lidos:       vals.length,
      primeira_leitura: primeira,
      ultima_leitura:   ultima,
      consumo_m3:       consumo,
      variacao_pct:     varPct,
      alerta,
    };
  }).sort((a, b) => b.consumo_m3 - a.consumo_m3);

  const casasTotal = maxCasas(linhas);

  const resumo = {
    total_medidores_lidos: linhas.length,
    consumo_total_m3:      +totalConsumo.toFixed(casasTotal),
    media_consumo_m3:      linhas.length > 0
      ? +(totalConsumo / linhas.length).toFixed(casasTotal)
      : 0,
    total_alertas:         linhas.filter(l => l.alerta).length,
    casas_decimais:        casasTotal,
  };

  const areaComum = calcAreaComum(linhas);

  const condo = await prisma.condominio.findUnique({ where: { id: condominio_id }, select: { nome: true } });

  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="acumulado-${mes}-${ano}.csv"`);
    return res.send('\uFEFF' + gerarCSVMensal(linhas, mesInt, anoInt));
  }

  if (formato === 'pdf') {
    return gerarPDFMensal(linhas, resumo, { condominio: condo?.nome || '', mes: mesInt, ano: anoInt }, res);
  }

  res.json({ condominio: condo?.nome, mes: mesInt, ano: anoInt, resumo, area_comum: areaComum, leituras: linhas });
}

// ── ALERTAS ───────────────────────────────────────────
async function alertas(req, res) {
  const { condominio_id, threshold = '20' } = req.query;
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
      const diff   = data.vals[i].valor - data.vals[i-1].valor;
      const base   = data.vals[i-1].valor;
      const varPct = base > 0 ? (diff / base) * 100 : 0;
      if (Math.abs(varPct) > THRESHOLD) {
        alertasEncontrados.push({
          medidor_id:   mid,
          unidade:      (data.unidade.bloco ? data.unidade.bloco + ' · ' : '') + data.unidade.identificador,
          dia:          data.vals[i].dia,
          valor_atual:  data.vals[i].valor,
          valor_ant:    data.vals[i-1].valor,
          variacao_m3:  +diff.toFixed(3),
          variacao_pct: +varPct.toFixed(1),
        });
      }
    }
  });

  res.json({ mes, ano, threshold: THRESHOLD, alertas: alertasEncontrados });
}

// ── EXTRATO POR UNIDADE ───────────────────────────────
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

  const diasNoMes  = new Date(anoInt, mesInt, 0).getDate();
  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

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

  const extratos = medidores.map(m => {
    const casas = m.casas_decimais ?? 2;
    const leiturasMap = {};
    m.leituras.forEach(l => { leiturasMap[l.referencia_dia] = l; });

    let consumoTotal  = 0;
    let valorAnterior = null;
    const linhas = [];

    for (let d = 1; d <= diasNoMes; d++) {
      const leitura  = leiturasMap[d];
      const diaSem   = diasSemana[new Date(anoInt, mesInt - 1, d).getDay()];
      const dataStr  = String(d).padStart(2,'0') + '/' + String(mesInt).padStart(2,'0') + '/' + anoInt;

      if (leitura) {
        const valor   = parseFloat(leitura.valor);
        const consumo = valorAnterior !== null ? +(valor - valorAnterior).toFixed(casas) : null;
        if (consumo !== null && consumo > 0) consumoTotal += consumo;
        valorAnterior = valor;
        linhas.push({
          dia: d, data: dataStr, dia_semana: diaSem,
          valor, consumo, leitor: leitura.user.nome,
          foto_url: leitura.foto_url, tem_foto: !!leitura.foto_url,
          sem_leitura: false,
        });
      } else {
        linhas.push({
          dia: d, data: dataStr, dia_semana: diaSem,
          valor: null, consumo: null, leitor: null,
          foto_url: null, tem_foto: false,
          sem_leitura: true,
        });
      }
    }

    return {
      medidor_id:     m.id,
      unidade:        m.unidade.identificador,
      bloco:          m.unidade.bloco,
      empresa:        m.unidade.empresa,
      tipo:           m.tipo,
      numero_serie:   m.numero_serie,
      casas_decimais: casas,
      consumo_total:  +consumoTotal.toFixed(casas),
      dias_lidos:     m.leituras.length,
      linhas,
    };
  });

  if (formato === 'csv') {
    const { gerarCSVExtrato } = require('../services/relatorioService');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="extrato-${mes}-${ano}.csv"`);
    return res.send('\uFEFF' + gerarCSVExtrato(extratos, mesInt, anoInt));
  }

  if (formato === 'pdf') {
    const { gerarPDFExtrato } = require('../services/relatorioService');
    return gerarPDFExtrato(extratos, { condominio: condo?.nome || '', mes: mesInt, ano: anoInt }, res);
  }

  res.json({ condominio: condo?.nome, mes: mesInt, ano: anoInt, extratos });
}

// ── GRÁFICO DONUT — consumo por empresa (mensal) ──────
async function consumoGrafico(req, res) {
  const { condominio_id, mes, ano, tipo } = req.query;
  if (!condominio_id) return res.status(400).json({ erro: 'condominio_id é obrigatório.' });
  if (!await verificarAcessoCondo(condominio_id, req.user)) {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }

  const mesInt = parseInt(mes || new Date().getMonth() + 1);
  const anoInt = parseInt(ano || new Date().getFullYear());

  const wheremedidor = { unidade: { condominio_id } };
  if (tipo && ['AGUA','ENERGIA','GAS'].includes(tipo)) wheremedidor.tipo = tipo;

  const leituras = await prisma.leitura.findMany({
    where: { referencia_mes: mesInt, referencia_ano: anoInt, medidor: wheremedidor },
    include: {
      medidor: {
        select: {
          tipo: true,
          casas_decimais: true,
          unidade: { select: { identificador: true, bloco: true, empresa: true } },
        },
      },
    },
    orderBy: [{ medidor_id: 'asc' }, { referencia_dia: 'asc' }],
  });

  const porUnidade = {};
  leituras.forEach(l => {
    const key = l.medidor_id;
    if (!porUnidade[key]) {
      porUnidade[key] = {
        label:    labelUnidade(l.medidor.unidade.bloco, l.medidor.unidade.identificador, l.medidor.unidade.empresa),
        empresa:  l.medidor.unidade.empresa,
        unidade:  l.medidor.unidade.identificador,
        bloco:    l.medidor.unidade.bloco,
        tipo:     l.medidor.tipo,
        casas:    l.medidor.casas_decimais ?? 2,
        primeira: parseFloat(l.valor),
        ultima:   parseFloat(l.valor),
      };
    } else {
      porUnidade[key].ultima = parseFloat(l.valor);
    }
  });

  const todos = Object.values(porUnidade).map(u => ({
    label:    u.label,
    empresa:  u.empresa,
    unidade:  u.unidade,
    bloco:    u.bloco,
    tipo:     u.tipo,
    geral:    isGeral(u.empresa),
    consumo:  +Math.max(0, u.ultima - u.primeira).toFixed(u.casas),
    casas:    u.casas,
  }));

  const privativos = todos
    .filter(u => !u.geral && u.consumo > 0)
    .sort((a, b) => b.consumo - a.consumo);

  const consumoGeral = todos.filter(u => u.geral).reduce((s, u) => s + u.consumo, 0);
  const consumoPriv  = privativos.reduce((s, u) => s + u.consumo, 0);
  const consumoComum = +(consumoGeral - consumoPriv).toFixed(
    todos.reduce((max, u) => Math.max(max, u.casas), 2)
  );

  const dados = [...privativos];
  const temGeral = todos.some(u => u.geral);
  if (temGeral && consumoComum > 0) {
    dados.push({ label: 'Área comum', consumo: consumoComum, area_comum: true });
  }

  const unidadeMedida = tipo === 'ENERGIA' ? 'kWh' : 'm³';
  res.json({ mes: mesInt, ano: anoInt, tipo: tipo || 'TODOS', unidade_medida: unidadeMedida, dados });
}

// ── GRÁFICO BARRAS — consumo por período ──────────────
async function consumoGraficoPeriodo(req, res) {
  const { condominio_id, data_inicio, data_fim, tipo } = req.query;
  if (!condominio_id || !data_inicio || !data_fim) {
    return res.status(400).json({ erro: 'condominio_id, data_inicio e data_fim são obrigatórios.' });
  }
  if (!await verificarAcessoCondo(condominio_id, req.user)) {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }

  const [iniA, iniM, iniD] = data_inicio.split('-').map(Number);
  const [fimA, fimM, fimD] = data_fim.split('-').map(Number);
  const inicioInt = iniA * 10000 + iniM * 100 + iniD;
  const fimInt    = fimA * 10000 + fimM * 100 + fimD;

  const wheremedidor = { unidade: { condominio_id } };
  if (tipo && ['AGUA','ENERGIA','GAS'].includes(tipo)) wheremedidor.tipo = tipo;

  const todasLeituras = await prisma.leitura.findMany({
    where: { medidor: wheremedidor },
    select: {
      medidor_id: true,
      valor: true,
      referencia_dia: true,
      referencia_mes: true,
      referencia_ano: true,
      medidor: {
        select: {
          tipo: true,
          casas_decimais: true,
          unidade: { select: { identificador: true, bloco: true, empresa: true } },
        },
      },
    },
    orderBy: [
      { medidor_id: 'asc' },
      { referencia_ano: 'asc' },
      { referencia_mes: 'asc' },
      { referencia_dia: 'asc' },
    ],
  });

  const leituras = todasLeituras.filter(l => {
    const dataInt = l.referencia_ano * 10000 + l.referencia_mes * 100 + l.referencia_dia;
    return dataInt >= inicioInt && dataInt <= fimInt;
  });

  const porMedidor = {};
  leituras.forEach(l => {
    const key = l.medidor_id;
    if (!porMedidor[key]) {
      porMedidor[key] = {
        label:    labelUnidade(l.medidor.unidade.bloco, l.medidor.unidade.identificador, l.medidor.unidade.empresa),
        empresa:  l.medidor.unidade.empresa,
        tipo:     l.medidor.tipo,
        casas:    l.medidor.casas_decimais ?? 2,
        primeira: parseFloat(l.valor),
        ultima:   parseFloat(l.valor),
      };
    } else {
      porMedidor[key].ultima = parseFloat(l.valor);
    }
  });

  const todos = Object.values(porMedidor).map(u => ({
    label:   u.label,
    empresa: u.empresa,
    tipo:    u.tipo,
    geral:   isGeral(u.empresa),
    consumo: +Math.max(0, u.ultima - u.primeira).toFixed(u.casas),
    casas:   u.casas,
  }));

  const privativos = todos
    .filter(u => !u.geral && u.consumo > 0)
    .sort((a, b) => b.consumo - a.consumo);

  const consumoGeral = todos.filter(u => u.geral).reduce((s, u) => s + u.consumo, 0);
  const consumoPriv  = privativos.reduce((s, u) => s + u.consumo, 0);
  const consumoComum = +(consumoGeral - consumoPriv).toFixed(
    todos.reduce((max, u) => Math.max(max, u.casas), 2)
  );

  const temGeral = todos.some(u => u.geral);
  const dadosBase = [...privativos];
  if (temGeral && consumoComum > 0) {
    dadosBase.push({ label: 'Área comum', consumo: consumoComum, area_comum: true });
  }
  const dados = dadosBase.sort((a, b) => b.consumo - a.consumo);

  const unidadeMedida = tipo === 'ENERGIA' ? 'kWh' : 'm³';
  res.json({ data_inicio, data_fim, tipo: tipo || 'TODOS', unidade_medida: unidadeMedida, dados });
}

module.exports = { periodo, mensal, alertas, extrato, consumoGrafico, consumoGraficoPeriodo };