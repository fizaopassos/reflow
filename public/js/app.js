'use strict';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── FORMATAÇÃO ───────────────────────────────────────
function fmtValor(valor, casas) {
  const c = casas !== undefined ? casas : 3;
  const num = typeof valor === 'string' ? parseFloat(valor) : valor;
  if (isNaN(num)) return '—';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
}

// Substitui as duas linhas do new Date no renderRelatorioPeriodo
function parseDateBR(str) {
  const [a, m, d] = str.split('-');
  return d + '/' + m + '/' + a;
}

function fmtVar(variacao, casas) {
  if (variacao === null || variacao === undefined) return '—';
  const c = casas !== undefined ? casas : 3;
  const num = parseFloat(variacao);
  if (isNaN(num)) return '—';
  return (num >= 0 ? '+' : '') + Math.abs(num).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
}

function diaSemana(dia, mes, ano) {
  return new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', { weekday: 'short' });
}

function interpretarInput(input, casas) {
  let str = String(input).trim();
  const temVirgula = str.includes(',');
  const temPonto   = str.includes('.');
  if (temVirgula || temPonto) {
    if (temVirgula) str = str.replace(/\./g, '').replace(',', '.');
    else {
      const partes = str.split('.');
      if (partes.length === 2 && partes[1].length <= 3) { /* ponto decimal ok */ }
      else str = str.replace(/\./g, '');
    }
    return parseFloat(str);
  }
  if (casas === 0) return parseInt(str);
  const padded  = str.padStart(casas + 1, '0');
  const intPart = padded.slice(0, -casas) || '0';
  const decPart = padded.slice(-casas);
  return parseFloat(intPart + '.' + decPart);
}

async function resolverFotoUrl(fotoUrl) {
  if (!fotoUrl) return null;
  if (fotoUrl.startsWith('/uploads/')) return fotoUrl;
  try {
    const data = await API.get('/fotos/signed-url?caminho=' + encodeURIComponent(fotoUrl));
    return data.url;
  } catch {
    return null;
  }
}

// ── AUTH ──────────────────────────────────────────────
const Auth = {
  get token()  { return localStorage.getItem('token'); },
  get user()   { try { return JSON.parse(atob(Auth.token.split('.')[1])); } catch { return null; } },
  isLogged()   { return !!Auth.token && !!Auth.user; },
  logout()     { localStorage.removeItem('token'); Router.go('login'); },
  is(role)     { return Auth.user?.role === role; },
  canAdmin()   { return Auth.is('ADMIN'); },
  canManage()  { return Auth.is('ADMIN') || Auth.is('GESTOR'); },
};

// ── TOAST ─────────────────────────────────────────────
function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + tipo;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── ROUTER ────────────────────────────────────────────
const Router = {
  current: null,
  prev: null,
  prevParams: {},
  params: {},
  go(page, params = {}) {
    if (!Auth.isLogged() && page !== 'login') { Router.go('login'); return; }
    if (Auth.isLogged() && page === 'login') {
      Router.go(Auth.is('LEITOR') ? 'leitor' : 'dashboard');
      return;
    }
    if (Auth.is('LEITOR') && !['leitor','leitura'].includes(page)) {
      Router.go('leitor');
      return;
    }
    Router.prev       = Router.current;
    Router.prevParams = Router.params;
    Router.current    = page;
    Router.params     = params;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById('view-' + page);
    if (view) view.classList.add('active');
    Navbar.render();
    Views[page]?.(params);
  }
};

function voltarDeLeitura() {
  if (Auth.is('LEITOR')) {
    Router.go('leitor');
    return;
  }
  if (Router.prev === 'medicoes' && Router.prevParams?.condominio_id) {
    Router.go('medicoes', Router.prevParams);
  } else {
    Router.go('dashboard');
  }
}

// ── NAVBAR ────────────────────────────────────────────
const Navbar = {
  render() {
    const nav = document.getElementById('navbar');
    const isDesktop = window.innerWidth >= 768;

    if (!Auth.isLogged()) {
      nav.style.display = 'none';
      nav.classList.add('nav-hidden');
      return;
    }

    nav.classList.remove('nav-hidden');

    if (isDesktop) {
      nav.style.display = '';
    } else {
      nav.style.display = 'flex';
    }

    nav.querySelectorAll('[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === Router.current);
    });

    if (Auth.is('LEITOR')) {
      nav.style.display = 'none';
      nav.classList.add('nav-hidden');
      return;
    }

    document.getElementById('nav-admin').style.display     = Auth.canAdmin()  ? 'flex' : 'none';
    document.getElementById('nav-relatorio').style.display = Auth.canManage() ? 'flex' : 'none';
    const navHist = document.getElementById('nav-historico');
    if (navHist) navHist.style.display = Auth.canManage() ? 'flex' : 'none';
  }
};

// ── VIEWS ─────────────────────────────────────────────
const Views = {};

// LOGIN
Views.login = () => {};

document.getElementById('form-login')?.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  try {
    const res = await API.login(
      document.getElementById('login-email').value,
      document.getElementById('login-senha').value
    );
    localStorage.setItem('token', res.token);
    if (res.role === 'LEITOR' || JSON.parse(atob(res.token.split('.')[1]))?.role === 'LEITOR') {
      Router.go('leitor');
    } else {
      Router.go('dashboard');
    }
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

// DASHBOARD
let _dashChart = null;
let _dashChartPeriodo = null;
let _dashCondominios = [];
const COR_AREA_COMUM = '#64748b';

function _popularSelectMes() {
  const sel = document.getElementById('dash-grafico-mes');
  if (!sel) return;
  const agora = new Date();
  const opts = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const a = d.getFullYear();
    const label = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    opts.push('<option value="' + m + '/' + a + '">' + label + '</option>');
  }
  sel.innerHTML = opts.join('');
}

async function atualizarGraficoConsumo() {
  if (!Auth.canManage()) return;
  const sel = document.getElementById('dash-grafico-mes');
  const agora = new Date();
  const partes = (sel?.value || (agora.getMonth() + 1) + '/' + agora.getFullYear()).split('/');
  const mes = partes[0], ano = partes[1];

  let condoId = _dashCondominios[0]?.id;
  const condoSelEl = document.getElementById('dash-grafico-condo-sel');
  if (condoSelEl) condoId = condoSelEl.value;
  if (!condoId) return;

  const tipoSel = document.getElementById('dash-grafico-tipo');
  const tipo    = tipoSel?.value || '';

  const canvas = document.getElementById('grafico-consumo');
  if (!canvas) return;

  try {
    let url = '/relatorios/consumo-grafico?condominio_id=' + condoId + '&mes=' + mes + '&ano=' + ano;
    if (tipo) url += '&tipo=' + tipo;

    const data = await API.get(url);
    if (_dashChart) { _dashChart.destroy(); _dashChart = null; }

    if (!data.dados || !data.dados.length) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = '';

    const unidade = data.unidade_medida || 'm³';
    const CORES = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#a855f7','#f97316','#84cc16'];

    // Área comum recebe cinza; privativos recebem cores normais
    let coresIdx = 0;
    const bgCores = data.dados.map(d =>
      d.area_comum ? COR_AREA_COMUM : CORES[coresIdx++ % CORES.length]
    );

    _dashChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: data.dados.map(d => d.label),
        datasets: [{
          data: data.dados.map(d => d.consumo),
          backgroundColor: bgCores,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + ctx.label + ': ' + Number(ctx.parsed).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 3}) + ' ' + unidade,
            },
          },
        },
      },
    });
  } catch (e) {
    console.error('Erro ao carregar gráfico de consumo:', e);
  }
}



async function atualizarGraficoPeriodo() {
  if (!Auth.canManage()) return;

  const ini = document.getElementById('dash-periodo-ini')?.value;
  const fim = document.getElementById('dash-periodo-fim')?.value;
  if (!ini || !fim) return;

  let condoId = _dashCondominios[0]?.id;
  const sel = document.getElementById('dash-periodo-condo-sel');
  if (sel?.value) condoId = sel.value;
  if (!condoId) return;

  const tipoSel = document.getElementById('dash-periodo-tipo');
  const tipo    = tipoSel?.value || '';

  const canvas = document.getElementById('grafico-periodo');
  const msgEl  = document.getElementById('grafico-periodo-msg');
  if (!canvas) return;

  if (msgEl) msgEl.textContent = 'Carregando...';
  canvas.style.display = 'none';

  try {
    let url = '/relatorios/consumo-grafico-periodo?condominio_id=' + condoId +
              '&data_inicio=' + ini + '&data_fim=' + fim;
    if (tipo) url += '&tipo=' + tipo;

    const data = await API.get(url);

    if (_dashChartPeriodo) { _dashChartPeriodo.destroy(); _dashChartPeriodo = null; }

    if (!data.dados || !data.dados.length) {
      if (msgEl) msgEl.textContent = 'Nenhum consumo registrado no período.';
      return;
    }

    if (msgEl) msgEl.textContent = '';
    canvas.style.display = '';

    const unidade = data.unidade_medida || 'm³';
    const altura  = Math.max(160, data.dados.length * 38);
    canvas.style.height = altura + 'px';
    canvas.height = altura;

    const CORES = ['#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6','#ec4899','#14b8a6','#a855f7','#f97316','#84cc16'];

    // Área comum recebe cinza; privativos recebem cores normais
    let coresIdx = 0;
    const bgCores     = data.dados.map(d => d.area_comum ? COR_AREA_COMUM + 'cc' : CORES[coresIdx++ % CORES.length] + 'cc');
    const borderCores = data.dados.map((d, i) => d.area_comum ? COR_AREA_COMUM : CORES[(i < coresIdx ? i : coresIdx - 1) % CORES.length]);

    // Recalcula índices corretamente para border
    let ci = 0;
    const bgFinal     = data.dados.map(d => d.area_comum ? COR_AREA_COMUM + 'cc' : CORES[ci++ % CORES.length] + 'cc');
    ci = 0;
    const borderFinal = data.dados.map(d => d.area_comum ? COR_AREA_COMUM     : CORES[ci++ % CORES.length]);

    _dashChartPeriodo = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.dados.map(d => d.label),
        datasets: [{
          label: 'Consumo ' + unidade,
          data:            data.dados.map(d => d.consumo),
          backgroundColor: bgFinal,
          borderColor:     borderFinal,
          borderWidth: 1.5,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ' ' + Number(ctx.parsed.x).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 3}) + ' ' + unidade,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { font: { size: 11 } },
            grid: { color: 'rgba(0,0,0,.06)' },
          },
          y: {
            ticks: {
              font: { size: 11 },
              maxRotation: 0,
              callback: function(val, idx) {
                const label = this.getLabelForValue(val);
                return label.length > 18 ? label.slice(0, 16) + '…' : label;
              },
            },
            grid: { display: false },
          },
        },
      },
    });
  } catch (e) {
    console.error('Erro ao carregar gráfico de período:', e);
    if (msgEl) msgEl.textContent = 'Erro ao carregar dados.';
  }
}


Views.dashboard = async () => {
  const user = Auth.user;
  document.getElementById('topbar-nome').textContent = user?.nome || '';

  const agora    = new Date();
  const mesLabel = agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  const mesTexto = 'Referência: ' + mesLabel;
  document.getElementById('dashboard-mes').textContent = mesTexto;
  const elMesDesktop = document.getElementById('dashboard-mes-desktop');
  if (elMesDesktop) elMesDesktop.textContent = mesTexto;

  const elLeituras = document.getElementById('dash-atalhos-leituras');
  const elAdmin    = document.getElementById('dash-atalhos-admin');
  if (elLeituras) elLeituras.style.display = Auth.canManage() ? '' : 'none';
  if (elAdmin)    elAdmin.style.display    = Auth.canAdmin()  ? '' : 'none';

  const elProg = document.getElementById('dash-progresso');
  elProg.innerHTML = '<p class="loading-msg">Carregando...</p>';

  try {
    const data = await API.dashboard();
    if (!data.condominios.length) {
      elProg.innerHTML = '<p class="empty-msg">Nenhum condomínio disponível.</p>';
      return;
    }

    const _renderCondo = c => {
      const pct        = c.percentual;
      const badgeClass = pct === 100 ? 'badge-ok' : pct > 50 ? 'badge-warn' : 'badge-pend';
      const nomeEsc    = c.nome.replace(/"/g, '');
      return '<div class="card card-condo" onclick="Router.go(&quot;medicoes&quot;,{condominio_id:&quot;' + c.id + '&quot;,nome:&quot;' + nomeEsc + '&quot;})">' +
        '<div class="card-header"><span class="card-title">' + c.nome + '</span>' +
        '<span class="badge ' + badgeClass + '">' + pct + '%</span></div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="card-meta">' +
        '<span>✓ ' + c.lidos + ' lidos</span>' +
        '<span>⏳ ' + c.pendentes + ' pendentes</span>' +
        '<span>Total: ' + c.total_medidores + '</span>' +
        '</div></div>';
    };

    const condosHtml = data.condominios.map(_renderCondo).join('');
    elProg.innerHTML = condosHtml;

    const elProgMobile = document.getElementById('dash-progresso-mobile');
    if (elProgMobile) elProgMobile.innerHTML = condosHtml;

    const elPend = document.getElementById('dash-pendentes');
    if (elPend) {
      const comPendentes = data.condominios.filter(c => c.pendentes > 0);
      elPend.innerHTML = comPendentes.length === 0
        ? '<p style="font-size:12px;color:var(--ok);text-align:center;padding:8px 0">✓ Todos lidos</p>'
        : comPendentes.map(c =>
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);gap:8px">' +
            '<span style="font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + c.nome + '</span>' +
            '<span class="badge badge-pend" style="flex-shrink:0">' + c.pendentes + '</span>' +
            '</div>'
          ).join('');
    }

    await Calendario.init();

    if (Auth.canManage()) {
      _dashCondominios = data.condominios;
      _popularSelectMes();

      if (data.condominios.length > 1) {
        const opts     = data.condominios.map(c => '<option value="' + c.id + '">' + c.nome + '</option>').join('');
        const condoSel = document.getElementById('dash-grafico-condo');
        if (condoSel) {
          condoSel.innerHTML = '<select id="dash-grafico-condo-sel" style="margin-top:8px;width:100%" onchange="atualizarGraficoConsumo()">' + opts + '</select>';
        }
      }

      await atualizarGraficoConsumo();
      const panelPeriodo = document.getElementById('dash-periodo-painel');
      if (panelPeriodo) panelPeriodo.style.display = '';
      await _iniciarGraficoPeriodo();
    } else {
      const panel = document.getElementById('grafico-consumo')?.closest('.dash-panel');
      if (panel) panel.style.display = 'none';
      const panelPeriodo = document.getElementById('dash-periodo-painel');
      if (panelPeriodo) panelPeriodo.style.display = 'none';
    }
  } catch (err) {
    elProg.innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
};

// MEDIÇÕES
Views.medicoes = async ({ condominio_id, nome }) => {
  document.getElementById('medicoes-titulo').textContent = nome || 'Medições';
  document.getElementById('medicoes-sub').textContent = 'Medidores do condomínio';
  const el = document.getElementById('medicoes-grid');
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';

  const agora   = new Date();
  const diaHoje = agora.getDate();
  const mesHoje = agora.getMonth() + 1;
  const anoHoje = agora.getFullYear();

  try {
    const [medidores, leituras, alertasData] = await Promise.all([
      API.get('/medidores?condominio_id=' + condominio_id),
      API.leituras.listar({ condominio_id, mes: mesHoje, ano: anoHoje }),
      API.get('/relatorios/alertas?condominio_id=' + condominio_id).catch(() => ({ alertas: [] })),
    ]);
    const alertasMedidores = new Set((alertasData.alertas || []).map(a => a.medidor_id));

    if (!medidores.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum medidor cadastrado neste condomínio.</p>';
      return;
    }

    const mapaLeituras = {};
    leituras.forEach(l => {
      if (!mapaLeituras[l.medidor_id]) mapaLeituras[l.medidor_id] = { leituraHoje: null, ultimaLeitura: null };
      if (l.referencia_dia === diaHoje && l.referencia_mes === mesHoje && l.referencia_ano === anoHoje) {
        mapaLeituras[l.medidor_id].leituraHoje = l;
      }
      const atual = mapaLeituras[l.medidor_id].ultimaLeitura;
      if (!atual || new Date(l.criado_em) > new Date(atual.criado_em)) {
        mapaLeituras[l.medidor_id].ultimaLeitura = l;
      }
    });

    const nomeSeguro = nome.replace(/"/g, '');
    el.innerHTML = medidores.map(m => {
      const { leituraHoje, ultimaLeitura } = mapaLeituras[m.id] || {};
      const tipoIcon  = { AGUA: '💧', ENERGIA: '⚡', GAS: '🔥' }[m.tipo] || '📊';
      const temAlerta = alertasMedidores.has(m.id);
      const badge     = leituraHoje
        ? '<span class="badge badge-ok">Hoje ✓</span>'
        : '<span class="badge badge-pend">Pendente hoje</span>';
      const alertaBadge = temAlerta ? ' <span class="badge badge-alerta">⚠ Variação</span>' : '';
      const casas       = m.casas_decimais !== undefined ? m.casas_decimais : 3;
      const ultimaInfo  = ultimaLeitura
        ? '<span>Última: <strong>' + fmtValor(ultimaLeitura.valor, casas) + '</strong> — ' +
          diaSemana(ultimaLeitura.referencia_dia, ultimaLeitura.referencia_mes, ultimaLeitura.referencia_ano) + ' ' +
          String(ultimaLeitura.referencia_dia).padStart(2,'0') + '/' + String(ultimaLeitura.referencia_mes).padStart(2,'0') + '</span>'
        : '<span style="color:var(--text3)">Sem leituras no mês</span>';
      const titulo  = (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') + (m.unidade?.identificador || '—');
      const empresa = m.unidade?.empresa || '';
      return '<div class="card card-medidor" onclick="abrirLeitura(\'' + m.id + '\',\'' + condominio_id + '\',\'' + nome.replace(/'/g,'') + '\')">' +
        '<div class="card-header"><div>' +
        '<div class="card-title">' + tipoIcon + ' ' + titulo + '</div>' +
        (empresa ? '<div style="font-size:12px;color:var(--text3)">' + empresa + '</div>' : '') +
        '</div>' + badge + alertaBadge + '</div>' +
        '<div class="card-meta"><span>Série: ' + (m.numero_serie || '—') + '</span>' + ultimaInfo + '</div>' +
        (Auth.canManage() ? '<div style="padding:8px 0 0;border-top:1px solid var(--border);margin-top:8px"><button class="btn-historico" data-mid="' + m.id + '" data-cid="' + condominio_id + '" data-cnome="' + nomeSeguro + '" onclick="event.stopPropagation();abrirHistoricoBtn(this)">📋 Ver histórico</button></div>' : '') +
        '</div>';
    }).join('');

    window._medidoresData = {};
    medidores.forEach(m => {
      window._medidoresData[m.id] = {
        unidade: (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') + (m.unidade?.identificador || ''),
        empresa: m.unidade?.empresa || '',
      };
    });

  } catch (err) {
    el.innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
};

function abrirLeitura(medidorId, condoId, condoNome) {
  const dados = window._medidoresData?.[medidorId] || {};
  Router.go('leitura', {
    medidor_id:      medidorId,
    unidade:         dados.unidade || '',
    empresa:         dados.empresa || '',
    condominio_id:   condoId,
    condominio_nome: condoNome,
  });
}

// LEITURA
Views.leitura = async ({ medidor_id, unidade, empresa, condominio_id, condominio_nome }) => {
  document.getElementById('leitura-unidade').textContent = unidade || 'Medidor';
  const subEl = document.getElementById('leitura-empresa-sub');
  if (subEl) subEl.textContent = empresa || '';

  window._casasDecimais = 3;
  if (medidor_id) {
    try {
      const med = await API.get('/medidores/' + medidor_id);
      window._casasDecimais = med.casas_decimais ?? 3;
      const hint  = document.getElementById('leitura-valor-hint');
      const casas = window._casasDecimais;
      const exemplos = {
        0: 'Digite os dígitos sem vírgula  ex: 51403',
        1: 'Digite todos os dígitos  ex: 51403 → 5.140,3',
        2: 'Inclua o zero final  ex: 121480 → 1.214,80',
        3: 'Digite todos os dígitos  ex: 4952634 → 4.952,634',
      };
      if (hint) { hint.textContent = exemplos[casas] || ''; hint.style.color = 'var(--text3)'; }
    } catch {}
  }

  document.getElementById('leitura-medidor-id').value = medidor_id || '';
  document.getElementById('leitura-id-edicao').value  = '';
  const agora = new Date();
  document.getElementById('leitura-dia').value = agora.getDate();
  document.getElementById('leitura-mes').value = agora.getMonth() + 1;
  document.getElementById('leitura-ano').value = agora.getFullYear();

  const campoData = document.getElementById('campo-data-retroativa');
  if (campoData) {
    campoData.style.display = Auth.canAdmin() ? 'block' : 'none';
    if (Auth.canAdmin()) {
      const retro = window._dataRetroativa || {};
      document.getElementById('leitura-dia-input').value = retro.dia || agora.getDate();
      document.getElementById('leitura-mes-input').value = retro.mes || (agora.getMonth() + 1);
      document.getElementById('leitura-ano-input').value = retro.ano || agora.getFullYear();
      window._dataRetroativa = null;
    }
  }

  document.getElementById('leitura-preview').style.display   = 'none';
  document.getElementById('leitura-idle').style.display      = 'flex';
  document.getElementById('form-leitura').style.display      = 'flex';
  document.getElementById('leitura-existente').style.display = 'none';
  document.getElementById('captureZone').style.display       = 'block';
  document.getElementById('leitura-file').value              = '';
  document.getElementById('leitura-file').disabled           = false;
  document.getElementById('captureZone').style.cursor        = 'pointer';
  document.getElementById('captureZone').style.pointerEvents = 'auto';
  document.getElementById('leitura-valor-input').value       = '';
  document.getElementById('leitura-obs-input').value         = '';
  document.getElementById('form-leitura-submit').textContent = 'Salvar leitura';

  if (medidor_id) {
    try {
      const leituraHoje = await API.leituras.buscarDia(medidor_id);
      if (leituraHoje) { mostrarLeituraExistente(leituraHoje); return; }
    } catch {}
  }
};

// ── LEITURA EXISTENTE ─────────────────────────────────
function mostrarLeituraExistente(leitura) {
  const el      = document.getElementById('leitura-existente');
  const canEdit = Auth.canManage();
  const editadoPor = leitura.editado_por
    ? ' · editado por ' + leitura.editado_por.nome
    : '';

  if (leitura.foto_url) {
    document.getElementById('captureZone').style.display     = 'block';
    document.getElementById('leitura-preview').style.display = 'block';
    document.getElementById('leitura-idle').style.display    = 'none';
    resolverFotoUrl(leitura.foto_url).then(url => {
      if (url) document.getElementById('leitura-preview').src = url;
    });
  }

  document.getElementById('leitura-file').disabled           = !canEdit;
  document.getElementById('captureZone').style.cursor        = canEdit ? 'pointer' : 'default';
  document.getElementById('captureZone').style.pointerEvents = canEdit ? 'auto' : 'none';

  const obsHtml = leitura.observacoes
    ? '<div class="result-obs" style="margin-top:8px">' + leitura.observacoes + '</div>'
    : '';

  let acoesHtml = '';
  if (canEdit) {
    acoesHtml =
      '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
        '<button class="btn-secondary btn-sm" style="flex:1" onclick="iniciarEdicao(\'' +
          leitura.id + '\',' + parseFloat(leitura.valor) + ',\'' +
          (leitura.observacoes || '').replace(/'/g, '') + '\',' +
          leitura.referencia_dia + ',' + leitura.referencia_mes + ',' + leitura.referencia_ano +
        ')">✏️ Editar</button>' +
        '<button class="btn-excluir btn-sm" style="flex:1" onclick="confirmarExclusao(\'' +
          leitura.id + '\',\'' +
          String(leitura.referencia_dia).padStart(2,'0') + '/' +
          String(leitura.referencia_mes).padStart(2,'0') + '/' +
          leitura.referencia_ano +
        '\')">🗑️ Excluir</button>' +
      '</div>';
  } else {
    acoesHtml = '<div style="font-size:12px;color:var(--text3);margin-top:10px">Somente gestor ou admin pode editar.</div>';
  }

  el.innerHTML =
    '<div class="leitura-existente-card">' +
      '<div style="font-size:11px;font-weight:700;color:var(--ok);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">✓ Leitura registrada</div>' +
      '<div class="result-valor" style="font-size:38px">' + fmtValor(leitura.valor, window._casasDecimais ?? 3) + '</div>' +
      '<div style="font-size:13px;color:var(--text2);margin-top:6px">Registrado por ' + leitura.user.nome + editadoPor + '</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:2px">' +
        String(leitura.referencia_dia).padStart(2,'0') + '/' +
        String(leitura.referencia_mes).padStart(2,'0') + '/' +
        leitura.referencia_ano +
      '</div>' +
      obsHtml + acoesHtml +
    '</div>';

  el.style.display = 'block';
  document.getElementById('form-leitura').style.display = 'none';
  if (!leitura.foto_url) document.getElementById('captureZone').style.display = 'none';
}

function iniciarEdicao(leituraId, valorAtual, obsAtual, dia, mes, ano) {
  document.getElementById('leitura-existente').style.display  = 'none';
  document.getElementById('leitura-id-edicao').value          = leituraId;
  document.getElementById('leitura-valor-input').value        = valorAtual;
  document.getElementById('leitura-obs-input').value          = obsAtual || '';
  document.getElementById('form-leitura').style.display       = 'flex';
  document.getElementById('form-leitura-submit').textContent  = '💾 Salvar alteração';
  document.getElementById('captureZone').style.display        = 'none';

  const campoData = document.getElementById('campo-data-retroativa');
  if (campoData && Auth.canAdmin()) {
    campoData.style.display = 'block';
    document.getElementById('leitura-dia-input').value = dia || '';
    document.getElementById('leitura-mes-input').value = mes || '';
    document.getElementById('leitura-ano-input').value = ano || '';
  }

  document.getElementById('leitura-valor-input').focus();
}

function confirmarExclusao(leituraId, dataStr) {
  abrirModal({
    icone: '🗑️',
    titulo: 'Excluir leitura',
    msg: 'Deseja excluir a leitura de ' + dataStr + '? Esta ação não pode ser desfeita.',
    tipo: 'danger',
    onConfirm: async () => {
      try {
        await API.leituras.deletar(leituraId);
        toast('Leitura excluída.', 'ok');
        setTimeout(() => voltarDeLeitura(), 600);
      } catch (err) {
        toast(err.message, 'erro');
      }
    }
  });
}

document.getElementById('leitura-valor-input')?.addEventListener('input', function() {
  const hint = document.getElementById('leitura-valor-hint');
  if (!hint || !this.value) { if(hint) hint.textContent = ''; return; }
  const casas = window._casasDecimais ?? 3;
  const num   = interpretarInput(this.value, casas);
  if (!isNaN(num)) {
    hint.textContent = '→ ' + fmtValor(num, casas);
    hint.style.color = 'var(--ok)';
  } else {
    hint.textContent = 'Valor inválido';
    hint.style.color = 'var(--danger)';
  }
});

document.getElementById('leitura-file')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('leitura-preview').src           = URL.createObjectURL(file);
  document.getElementById('leitura-preview').style.display = 'block';
  document.getElementById('leitura-idle').style.display    = 'none';
});

document.getElementById('form-leitura')?.addEventListener('submit', async e => {
  e.preventDefault();
  const valor      = document.getElementById('leitura-valor-input').value;
  const medidor_id = document.getElementById('leitura-medidor-id').value;
  const dia        = document.getElementById('leitura-dia').value;
  const mes        = document.getElementById('leitura-mes').value;
  const ano        = document.getElementById('leitura-ano').value;
  const file       = document.getElementById('leitura-file').files[0];
  const leituraId  = document.getElementById('leitura-id-edicao').value;
  const btn        = document.getElementById('form-leitura-submit');

  const casas    = window._casasDecimais ?? 3;
  const valorNum = interpretarInput(valor, casas);
  if (!valor || isNaN(valorNum) || valorNum < 0) { toast('Digite um valor válido.', 'warn'); return; }
  if (valorNum >= 99999999) { toast('Valor muito alto. Verifique se digitou certo.', 'warn'); return; }

  btn.disabled = true;
  try {
    if (leituraId) {
      const obs  = document.getElementById('leitura-obs-input')?.value;
      const body = { valor, observacoes: obs };
      if (Auth.canAdmin()) {
        const dR = document.getElementById('leitura-dia-input')?.value;
        const mR = document.getElementById('leitura-mes-input')?.value;
        const aR = document.getElementById('leitura-ano-input')?.value;
        if (dR && mR && aR) { body.referencia_dia = dR; body.referencia_mes = mR; body.referencia_ano = aR; }
      }
      await API.leituras.editar(leituraId, body);
      toast('✓ Leitura atualizada!', 'ok');
    } else {
      if (!file) { toast('Foto obrigatória. Fotografe o medidor.', 'warn'); btn.disabled = false; return; }
      const obs = document.getElementById('leitura-obs-input')?.value;

      let diaFinal = dia, mesFinal = mes, anoFinal = ano;
      if (Auth.canAdmin()) {
        const diaR = document.getElementById('leitura-dia-input')?.value;
        const mesR = document.getElementById('leitura-mes-input')?.value;
        const anoR = document.getElementById('leitura-ano-input')?.value;
        if (diaR && mesR && anoR) { diaFinal = diaR; mesFinal = mesR; anoFinal = anoR; }
      }

      const form = new FormData();
      form.append('medidor_id',     medidor_id);
      form.append('valor',          valor);
      form.append('referencia_dia', diaFinal);
      form.append('referencia_mes', mesFinal);
      form.append('referencia_ano', anoFinal);
      form.append('metodo',         'MANUAL');
      form.append('observacoes',    obs || '');
      form.append('imagem',         file);
      await API.leituras.registrar(form);
      toast('✓ Leitura salva!', 'ok');
    }
    setTimeout(() => voltarDeLeitura(), 800);
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

async function _iniciarGraficoPeriodo() {
  if (!Auth.canManage()) return;

  const hoje = new Date();
  const ini  = new Date(hoje); ini.setDate(ini.getDate() - 29);
  const fmt  = d => d.toISOString().split('T')[0];

  const iniEl = document.getElementById('dash-periodo-ini');
  const fimEl = document.getElementById('dash-periodo-fim');
  if (iniEl && !iniEl.value) iniEl.value = fmt(ini);
  if (fimEl && !fimEl.value) fimEl.value = fmt(hoje);

  if (_dashCondominios.length > 1) {
    const condoWrap = document.getElementById('dash-periodo-condo-wrap');
    if (condoWrap) {
      const opts = _dashCondominios.map(c => '<option value="' + c.id + '">' + c.nome + '</option>').join('');
      condoWrap.innerHTML = '<select id="dash-periodo-condo-sel" style="font-size:12px;padding:4px 8px;width:100%;margin-bottom:8px" onchange="atualizarGraficoPeriodo()">' + opts + '</select>';
    }
  }

  await atualizarGraficoPeriodo();
}

// ── VIEW LEITOR ───────────────────────────────────────
Views.leitor = async () => {
  if (!Auth.is('LEITOR')) { Router.go('dashboard'); return; }

  const user    = Auth.user;
  const agora   = new Date();
  const diaHoje = agora.getDate();
  const mesHoje = agora.getMonth() + 1;
  const anoHoje = agora.getFullYear();

  const nomeEl = document.getElementById('leitor-nome');
  if (nomeEl) nomeEl.textContent = user?.nome || '';

  const progressoEl = document.getElementById('leitor-progresso');
  const listaEl     = document.getElementById('leitor-lista');
  if (!listaEl) return;

  listaEl.innerHTML = '<p class="loading-msg">Carregando...</p>';

  try {
    const data = await API.dashboard();
    if (!data.condominios.length) {
      listaEl.innerHTML = '<p class="empty-msg">Nenhum condomínio vinculado.</p>';
      return;
    }

    const condo = data.condominios[0];
    window._leitorCondoId   = condo.id;
    window._leitorCondoNome = condo.nome;

    const [medidores, leituras] = await Promise.all([
      API.get('/medidores?condominio_id=' + condo.id),
      API.leituras.listar({ condominio_id: condo.id, mes: mesHoje, ano: anoHoje }),
    ]);

    const leitosHoje = new Set();
    leituras.forEach(l => {
      if (l.referencia_dia === diaHoje && l.referencia_mes === mesHoje && l.referencia_ano === anoHoje) {
        leitosHoje.add(l.medidor_id);
      }
    });

    const total = medidores.length;
    const lidos = leitosHoje.size;
    const pct   = total > 0 ? Math.round(lidos / total * 100) : 0;

    if (progressoEl) {
      progressoEl.innerHTML =
        '<div class="leitor-prog-texto">' +
          '<span class="leitor-prog-num">' + lidos + ' de ' + total + '</span>' +
          ' lidos hoje' +
        '</div>' +
        '<div class="progress-bar" style="margin-top:8px">' +
          '<div class="progress-fill" style="width:' + pct + '%;background:' + (pct === 100 ? 'var(--ok)' : 'var(--blue)') + '"></div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text3);margin-top:4px;text-align:right">' + pct + '%</div>';
    }

    const pendentes = medidores.filter(m => !leitosHoje.has(m.id));
    const lidosList = medidores.filter(m =>  leitosHoje.has(m.id));
    const ordenados = [...pendentes, ...lidosList];

    const ultimaLeitura = {};
    leituras.forEach(l => {
      const atual = ultimaLeitura[l.medidor_id];
      if (!atual || new Date(l.criado_em) > new Date(atual.criado_em)) {
        ultimaLeitura[l.medidor_id] = l;
      }
    });

    window._medidoresData = {};
    ordenados.forEach(m => {
      window._medidoresData[m.id] = {
        unidade: (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') + (m.unidade?.identificador || ''),
        empresa: m.unidade?.empresa || '',
      };
    });

    listaEl.innerHTML = ordenados.map(m => {
      const lido      = leitosHoje.has(m.id);
      const tipoIcon  = { AGUA: '💧', ENERGIA: '⚡', GAS: '🔥' }[m.tipo] || '📊';
      const casas     = m.casas_decimais ?? 3;
      const titulo    = (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') + (m.unidade?.identificador || '—');
      const empresa   = m.unidade?.empresa || '';
      const ultima    = ultimaLeitura[m.id];
      const ultimaStr = ultima
        ? 'Última: ' + parseFloat(ultima.valor).toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas})
        : 'Sem leituras';

      return '<div class="leitor-card' + (lido ? ' leitor-card-lido' : ' leitor-card-pend') + '" ' +
        'onclick="abrirLeitura(&quot;' + m.id + '&quot;,&quot;' + condo.id + '&quot;,&quot;' + condo.nome.replace(/"/g,'') + '&quot;)">' +
        '<div class="leitor-card-icon">' + (lido ? '✅' : '⏳') + '</div>' +
        '<div class="leitor-card-info">' +
          '<div class="leitor-card-titulo">' + tipoIcon + ' ' + titulo + '</div>' +
          (empresa ? '<div class="leitor-card-empresa">' + empresa + '</div>' : '') +
          '<div class="leitor-card-meta">' + ultimaStr + '</div>' +
        '</div>' +
        '<div class="leitor-card-status">' +
          (lido ? '<span class="badge badge-ok">✓ Lido</span>' : '<span class="badge badge-pend">Pendente</span>') +
        '</div>' +
      '</div>';
    }).join('');

  } catch (err) {
    listaEl.innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
};

// ── HISTÓRICO DE LEITURAS ─────────────────────────────
Views.historico = async ({ medidor_id, medidor_label, condominio_id, condominio_nome } = {}) => {
  if (!Auth.canManage()) { Router.go('dashboard'); return; }

  window._historicoCtx = { medidor_id, medidor_label, condominio_id, condominio_nome };

  const tituloEl   = document.getElementById('historico-titulo');
  const subEl      = document.getElementById('historico-sub');
  const seletores  = document.getElementById('historico-seletores');
  const filtros    = document.getElementById('historico-filtros');
  const lista      = document.getElementById('historico-lista');
  const massaPanel = document.getElementById('historico-massa-panel');

  _historicoSwitchAba('historico');

  if (medidor_id) {
    if (tituloEl) tituloEl.textContent = medidor_label || 'Histórico';
    if (subEl)    subEl.textContent    = condominio_nome || '';
    if (seletores) seletores.style.display = 'none';
    const abasEl = document.getElementById('historico-abas');
    if (abasEl) abasEl.style.display = '';
    if (filtros) filtros.style.display = '';
    _historicoPopularFiltros();
    await _historicoCarregar();
    return;
  }

  if (tituloEl) tituloEl.textContent = 'Histórico';
  if (subEl)    subEl.textContent    = 'Selecione o medidor';
  if (seletores)  seletores.style.display  = '';
  if (filtros)    filtros.style.display    = 'none';
  if (massaPanel) massaPanel.style.display = 'none';
  if (lista)      lista.innerHTML = '';

  await _historicoPopularSeletores();
};

async function _historicoPopularSeletores() {
  const selCondo = document.getElementById('hist-sel-condo');
  const selMed   = document.getElementById('hist-sel-medidor');
  const btnVer   = document.getElementById('hist-btn-ver');
  if (!selCondo) return;

  try {
    const condos = await API.condominios.listar();
    selCondo.innerHTML = '<option value="">Selecione o condomínio...</option>' +
      condos.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    selMed.innerHTML = '<option value="">Selecione o medidor...</option>';

    selCondo.onchange = async () => {
      selMed.innerHTML = '<option value="">Carregando...</option>';
      if (!selCondo.value) { selMed.innerHTML = '<option value="">Selecione o medidor...</option>'; return; }
      try {
        const meds = await API.get('/medidores?condominio_id=' + selCondo.value);
        selMed.innerHTML = '<option value="">Selecione o medidor...</option>' +
          meds.map(m => {
            const label = (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') +
                          (m.unidade?.identificador || '—') +
                          (m.unidade?.empresa ? ' — ' + m.unidade.empresa : '');
            return `<option value="${m.id}" data-label="${label}">${label}</option>`;
          }).join('');
      } catch { selMed.innerHTML = '<option value="">Erro ao carregar</option>'; }
    };

    btnVer.onclick = async () => {
      const condoId   = selCondo.value;
      const condoNome = selCondo.options[selCondo.selectedIndex]?.text || '';
      const medId     = selMed.value;
      const medLabel  = selMed.options[selMed.selectedIndex]?.text || 'Medidor';
      if (!condoId || !medId) { toast('Selecione o condomínio e o medidor.', 'warn'); return; }

      window._historicoCtx = {
        medidor_id:      medId,
        medidor_label:   medLabel,
        condominio_id:   condoId,
        condominio_nome: condoNome,
      };

      const tituloEl  = document.getElementById('historico-titulo');
      const subEl     = document.getElementById('historico-sub');
      const seletores = document.getElementById('historico-seletores');
      const filtros   = document.getElementById('historico-filtros');
      if (tituloEl)  tituloEl.textContent = medLabel;
      if (subEl)     subEl.textContent    = condoNome;
      if (seletores) seletores.style.display = 'none';
      if (filtros)   filtros.style.display   = '';
      const abasEl = document.getElementById('historico-abas');
      if (abasEl) abasEl.style.display = '';

      // Usa aba inicial se definida pelo atalho, senão vai para histórico
      const abaAlvo = window._historicoAbaInicial || 'historico';
      window._historicoAbaInicial = null;
      _historicoSwitchAba(abaAlvo);
      _historicoPopularFiltros();
      await _historicoCarregar();
    };
  } catch (err) {
    document.getElementById('historico-lista').innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
}

function _historicoSwitchAba(aba) {
  const tabEls = document.querySelectorAll('.hist-tab');
  const panels = {
    historico: document.getElementById('historico-aba-historico'),
    massa:     document.getElementById('historico-aba-massa'),
  };
  tabEls.forEach(t => t.classList.toggle('active', t.dataset.aba === aba));
  Object.entries(panels).forEach(([k, el]) => { if (el) el.style.display = k === aba ? '' : 'none'; });
  if (aba === 'massa' && window._historicoCtx?.medidor_id) {
    _massaIniciar();
  }
}

function _historicoPopularFiltros() {
  const selMes = document.getElementById('hist-filtro-mes');
  const selAno = document.getElementById('hist-filtro-ano');
  if (!selMes || !selAno) return;

  const agora = new Date();
  const meses = ['Todos','Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  selMes.innerHTML = meses.map((m, i) =>
    `<option value="${i === 0 ? '' : i}"${i === agora.getMonth() + 1 ? ' selected' : ''}>${m}</option>`
  ).join('');

  const anos = [];
  for (let i = 0; i < 3; i++) anos.push(agora.getFullYear() - i);
  selAno.innerHTML = anos.map(a =>
    `<option value="${a}"${a === agora.getFullYear() ? ' selected' : ''}>${a}</option>`
  ).join('');
}

async function _historicoCarregar() {
  const el  = document.getElementById('historico-lista');
  const ctx = window._historicoCtx;
  if (!el || !ctx?.medidor_id) return;

  el.innerHTML = '<p class="loading-msg">Carregando...</p>';

  const mes = document.getElementById('hist-filtro-mes')?.value || '';
  const ano = document.getElementById('hist-filtro-ano')?.value || '';

  try {
    let url = '/leituras?medidor_id=' + ctx.medidor_id;
    if (mes) url += '&mes=' + mes;
    if (ano) url += '&ano=' + ano;

    const [leituras, med] = await Promise.all([
      API.get(url),
      API.get('/medidores/' + ctx.medidor_id).catch(() => ({ casas_decimais: 3 })),
    ]);
    const casas = med.casas_decimais ?? 3;

    if (!leituras.length) {
      el.innerHTML = '<p class="empty-msg">Nenhuma leitura encontrada para este período.</p>';
      return;
    }

    el.innerHTML = leituras.map(l => {
      const dataStr =
        String(l.referencia_dia).padStart(2,'0') + '/' +
        String(l.referencia_mes).padStart(2,'0') + '/' +
        l.referencia_ano;
      const diaSem     = diaSemana(l.referencia_dia, l.referencia_mes, l.referencia_ano);
      const editadoPor = l.editado_por ? ' · editado por ' + l.editado_por.nome : '';
      const metodoIcon = { GEMINI: '🤖', MANUAL: '✍️', AUTOMATICO: '⚙️' }[l.metodo] || '';
      const fotoHtml   = l.foto_url
        ? `<a href="#" onclick="abrirFoto('${l.foto_url}', event);return false;" class="hist-foto-link" title="Ver foto">📷</a>`
        : '';
      const obsHtml = l.observacoes ? `<div class="hist-obs">${l.observacoes}</div>` : '';

      return `<div class="hist-item" id="hist-item-${l.id}">
        <div class="hist-item-header">
          <div>
            <span class="hist-data">${diaSem} ${dataStr}</span>
            <span class="hist-valor">${fmtValor(l.valor, casas)}</span>
          </div>
          <div class="hist-actions">
            ${fotoHtml}
            <button class="btn-secondary btn-sm" onclick="historicoIniciarEdicao('${l.id}',${parseFloat(l.valor)},'${(l.observacoes||'').replace(/'/g,'')}',${l.referencia_dia},${l.referencia_mes},${l.referencia_ano})">✏️</button>
            <button class="btn-excluir btn-sm" onclick="historicoConfirmarExclusao('${l.id}','${dataStr}')">🗑️</button>
          </div>
        </div>
        <div class="hist-meta"><span>${metodoIcon} ${l.user.nome}${editadoPor}</span></div>
        ${obsHtml}
        <div class="hist-edit-form" id="hist-edit-${l.id}" style="display:none">
          <div class="form-row" style="margin-top:10px">
            <div class="field" style="flex:2;min-width:120px">
              <label>Valor</label>
              <input type="text" id="hist-valor-${l.id}" value="${parseFloat(l.valor)}" inputmode="decimal">
            </div>
          </div>
          <div class="field">
            <label>Observações</label>
            <input type="text" id="hist-obs-${l.id}" value="${l.observacoes || ''}" placeholder="opcional">
          </div>
          <div style="display:flex;gap:8px;margin-top:4px">
            <button class="btn-primary btn-sm" style="flex:1" onclick="historicoSalvarEdicao('${l.id}',${l.referencia_dia},${l.referencia_mes},${l.referencia_ano})">💾 Salvar</button>
            <button class="btn-secondary btn-sm" style="flex:1" onclick="historicoFecharEdicao('${l.id}')">Cancelar</button>
          </div>
        </div>
      </div>`;
    }).join('');

  } catch (err) {
    el.innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
}

function historicoIniciarEdicao(id) {
  document.querySelectorAll('.hist-edit-form').forEach(f => f.style.display = 'none');
  const form = document.getElementById('hist-edit-' + id);
  if (form) form.style.display = 'block';
}

function historicoFecharEdicao(id) {
  const form = document.getElementById('hist-edit-' + id);
  if (form) form.style.display = 'none';
}

async function historicoSalvarEdicao(id, dia, mes, ano) {
  const valor = document.getElementById('hist-valor-' + id)?.value;
  const obs   = document.getElementById('hist-obs-'   + id)?.value;
  if (!valor) { toast('Digite um valor.', 'warn'); return; }
  try {
    await API.leituras.editar(id, { valor, observacoes: obs, referencia_dia: dia, referencia_mes: mes, referencia_ano: ano });
    toast('✓ Leitura atualizada!', 'ok');
    await _historicoCarregar();
  } catch (err) {
    toast(err.message, 'erro');
  }
}

function historicoConfirmarExclusao(id, dataStr) {
  abrirModal({
    icone: '🗑️',
    titulo: 'Excluir leitura',
    msg: 'Deseja excluir a leitura de ' + dataStr + '? Esta ação não pode ser desfeita.',
    tipo: 'danger',
    onConfirm: async () => {
      try {
        await API.leituras.deletar(id);
        toast('Leitura excluída.', 'ok');
        await _historicoCarregar();
      } catch (err) {
        toast(err.message, 'erro');
      }
    }
  });
}

function voltarDeHistorico() {
  const ctx = window._historicoCtx;
  if (ctx?.condominio_id) {
    Router.go('medicoes', { condominio_id: ctx.condominio_id, nome: ctx.condominio_nome });
  } else {
    Router.go('dashboard');
  }
}

function abrirHistorico(medidorId, condoId, condoNome) {
  const dados = window._medidoresData?.[medidorId] || {};
  Router.go('historico', {
    medidor_id:      medidorId,
    medidor_label:   dados.unidade || 'Medidor',
    condominio_id:   condoId,
    condominio_nome: condoNome,
  });
}

function abrirHistoricoBtn(btn) {
  abrirHistorico(btn.dataset.mid, btn.dataset.cid, btn.dataset.cnome);
}

// ── LANÇAMENTO EM MASSA ───────────────────────────────
async function _massaIniciar() {
  const panel = document.getElementById('massa-form');
  if (!panel) return;

  const hoje = new Date();
  const ini  = new Date(hoje);
  ini.setDate(ini.getDate() - 6);

  const fmtDate = d => d.toISOString().split('T')[0];
  const iniEl = document.getElementById('massa-data-ini');
  const fimEl = document.getElementById('massa-data-fim');
  if (iniEl && !iniEl.value) iniEl.value = fmtDate(ini);
  if (fimEl && !fimEl.value) fimEl.value = fmtDate(hoje);

  document.getElementById('massa-linhas').innerHTML   = '';
  document.getElementById('massa-resultado').innerHTML = '';
}

async function massaGerarLinhas() {
  const ctx  = window._historicoCtx;
  const iniV = document.getElementById('massa-data-ini')?.value;
  const fimV = document.getElementById('massa-data-fim')?.value;
  if (!ctx?.medidor_id) { toast('Nenhum medidor selecionado.', 'warn'); return; }
  if (!iniV || !fimV)   { toast('Preencha as datas.', 'warn'); return; }
  if (iniV > fimV)      { toast('Data inicial maior que final.', 'warn'); return; }

  const ini      = new Date(iniV + 'T00:00:00');
  const fim      = new Date(fimV + 'T00:00:00');
  const diffDias = Math.round((fim - ini) / 86400000) + 1;
  if (diffDias > 31) { toast('Máximo de 31 dias por vez.', 'warn'); return; }

  const el = document.getElementById('massa-linhas');
  el.innerHTML = '<p class="loading-msg">Verificando leituras existentes...</p>';

  let leituraExistentes = [];
  try {
    const mesesEnvolvidos = new Set();
    let cur = new Date(ini);
    while (cur <= fim) {
      mesesEnvolvidos.add((cur.getMonth()+1) + '/' + cur.getFullYear());
      cur.setMonth(cur.getMonth() + 1);
    }
    for (const mv of mesesEnvolvidos) {
      const [m, a] = mv.split('/');
      const res = await API.get('/leituras?medidor_id=' + ctx.medidor_id + '&mes=' + m + '&ano=' + a);
      leituraExistentes = leituraExistentes.concat(res);
    }
  } catch {}

  const existeMap = {};
  leituraExistentes.forEach(l => {
    const key = l.referencia_ano + '-' +
      String(l.referencia_mes).padStart(2,'0') + '-' +
      String(l.referencia_dia).padStart(2,'0');
    existeMap[key] = l;
  });

  let casas = 3;
  try { const m = await API.get('/medidores/' + ctx.medidor_id); casas = m.casas_decimais ?? 3; } catch {}
  window._massaCasas = casas;

  const diasSemana = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  let html = '';
  let d    = new Date(ini);

  while (d <= fim) {
    const ano  = d.getFullYear();
    const mes  = d.getMonth() + 1;
    const dia  = d.getDate();
    const key  = ano + '-' + String(mes).padStart(2,'0') + '-' + String(dia).padStart(2,'0');
    const dsem = diasSemana[d.getDay()];
    const dataLabel = dsem + ' ' + String(dia).padStart(2,'0') + '/' + String(mes).padStart(2,'0') + '/' + ano;
    const existente = existeMap[key];

    if (existente) {
      html += `<div class="massa-linha massa-linha-ok">
        <div class="massa-linha-data">${dataLabel}</div>
        <div class="massa-linha-existente">
          <span class="badge badge-ok">✓ ${parseFloat(existente.valor).toLocaleString('pt-BR', {minimumFractionDigits: casas, maximumFractionDigits: casas})}</span>
          <span style="font-size:11px;color:var(--text3)">${existente.user?.nome || ''}</span>
        </div>
      </div>`;
    } else {
      html += `<div class="massa-linha" id="massa-linha-${key}" data-dia="${dia}" data-mes="${mes}" data-ano="${ano}">
        <div class="massa-linha-data">${dataLabel}</div>
        <div class="massa-linha-campos">
          <input type="text" class="massa-valor-input" id="massa-val-${key}" inputmode="decimal" placeholder="valor" autocomplete="off">
          <label class="massa-foto-label" title="Anexar foto">
            📷
            <input type="file" accept="image/*" id="massa-foto-${key}" class="massa-foto-input" onchange="massaFotoPreview(this,'${key}')">
          </label>
          <span class="massa-foto-preview" id="massa-prev-${key}"></span>
        </div>
      </div>`;
    }
    d.setDate(d.getDate() + 1);
  }

  el.innerHTML = html || '<p class="empty-msg">Nenhum dia pendente neste intervalo.</p>';
  const primeiro = el.querySelector('.massa-valor-input');
  if (primeiro) setTimeout(() => primeiro.focus(), 100);
}

function massaFotoPreview(input, key) {
  const prev = document.getElementById('massa-prev-' + key);
  if (!prev) return;
  prev.innerHTML = input.files[0] ? '<span style="font-size:11px;color:var(--ok)">✓ foto</span>' : '';
}

async function massaSalvar() {
  const ctx   = window._historicoCtx;
  const casas = window._massaCasas ?? 3;
  if (!ctx?.medidor_id) { toast('Nenhum medidor selecionado.', 'warn'); return; }

  const linhas     = document.querySelectorAll('.massa-linha[data-dia]');
  const paraEnviar = [];

  linhas.forEach(linha => {
    const key   = linha.id.replace('massa-linha-', '');
    const valor = document.getElementById('massa-val-' + key)?.value?.trim();
    if (!valor) return;
    const foto = document.getElementById('massa-foto-' + key)?.files[0] || null;
    paraEnviar.push({ dia: parseInt(linha.dataset.dia), mes: parseInt(linha.dataset.mes), ano: parseInt(linha.dataset.ano), valor, foto, key });
  });

  if (!paraEnviar.length) { toast('Nenhum valor preenchido.', 'warn'); return; }

  const btnSalvar = document.getElementById('massa-btn-salvar');
  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando...';

  const resultado = document.getElementById('massa-resultado');
  resultado.innerHTML = '';

  let ok = 0, erros = 0;

  for (const item of paraEnviar) {
    try {
      const form = new FormData();
      form.append('medidor_id',     ctx.medidor_id);
      form.append('valor',          item.valor);
      form.append('referencia_dia', item.dia);
      form.append('referencia_mes', item.mes);
      form.append('referencia_ano', item.ano);
      form.append('metodo',         'MANUAL');
      if (item.foto) form.append('imagem', item.foto);

      await fetch('/api/leituras', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + Auth.token },
        body: form,
      }).then(async r => {
        if (!r.ok) { const err = await r.json(); throw new Error(err.erro || 'Erro ' + r.status); }
        return r.json();
      });

      const linha = document.getElementById('massa-linha-' + item.key);
      if (linha) {
        linha.classList.add('massa-linha-ok');
        linha.querySelector('.massa-linha-campos').innerHTML = '<span class="badge badge-ok">✓ salvo</span>';
      }
      ok++;
    } catch (err) {
      const linha = document.getElementById('massa-linha-' + item.key);
      if (linha) {
        linha.style.borderColor = 'var(--danger)';
        const campos = linha.querySelector('.massa-linha-campos');
        if (campos) campos.innerHTML += '<span style="font-size:11px;color:var(--danger);margin-left:6px">⚠ ' + err.message + '</span>';
      }
      erros++;
    }
  }

  btnSalvar.disabled = false;
  btnSalvar.textContent = '💾 Salvar leituras';

  if (ok > 0 && erros === 0) {
    toast('✓ ' + ok + ' leitura(s) salva(s)!', 'ok');
    resultado.innerHTML = '<p style="color:var(--ok);font-weight:600;padding:8px 0">✓ ' + ok + ' leitura(s) registrada(s) com sucesso.</p>';
  } else if (erros > 0) {
    toast(ok + ' salvas, ' + erros + ' com erro.', 'warn');
  }
}

// ── ADMIN TABS ────────────────────────────────────────
function switchTab(name) {
  const tabs = ['condos','unidades','medidores','users'];
  document.querySelectorAll('.admin-tab').forEach((t, i) => t.classList.toggle('active', tabs[i] === name));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'users') carregarUsersAdmin();
}

Views.admin = async () => {
  if (!Auth.canAdmin()) { Router.go('dashboard'); return; }
  await carregarCondosAdmin();
  await preencherSelectCondos();
};

async function carregarCondosAdmin() {
  const el = document.getElementById('admin-condos-list');
  try {
    const [condos, users] = await Promise.all([API.condominios.listar(), API.users.listar()]);
    const gestores = users.filter(u => u.role === 'GESTOR' && u.ativo);
    const leitores = users.filter(u => u.role === 'LEITOR'  && u.ativo);

    if (!condos.length) { el.innerHTML = '<p class="empty-msg">Nenhum condomínio.</p>'; return; }

    el.innerHTML = condos.map(c => {
      const optsGestores = gestores.map(g => '<option value="' + g.id + '">' + g.nome + ' (' + g.email + ')</option>').join('');
      const optsLeitores = leitores.map(l => '<option value="' + l.id + '">' + l.nome + ' (' + l.email + ')</option>').join('');
      return '<div class="condo-card" id="condo-card-' + c.id + '">' +
        '<div class="list-item condo-header" onclick="toggleCondo(\'' + c.id + '\')">' +
        '<div class="list-item-info"><span class="list-item-title">' + c.nome + '</span>' +
        '<span class="list-item-sub">' + (c.endereco || '') + (c.cidade ? ' · ' + c.cidade : '') + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<span class="badge badge-pend">' + (c._count?.unidades || 0) + ' unid.</span>' +
        '<svg class="condo-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" style="transition:transform .2s;color:var(--text3)"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
        '</div></div>' +
        '<div class="condo-gestores" id="gestores-' + c.id + '" style="display:none">' +
        '<div class="condo-inner-tabs">' +
        '<button class="condo-inner-tab active" onclick="switchCondoTab(\'' + c.id + '\',\'gestores\')">Gestores</button>' +
        '<button class="condo-inner-tab" onclick="switchCondoTab(\'' + c.id + '\',\'leitores\')">Leitores</button>' +
        '</div>' +
        '<div class="condo-inner-panel active" id="panel-gestores-' + c.id + '">' +
        '<div class="gestores-inner" id="gestores-inner-' + c.id + '"><p class="loading-msg" style="padding:12px">Carregando...</p></div>' +
        '<div class="gestores-add"><select id="select-gestor-' + c.id + '" class="gestor-select"><option value="">Adicionar gestor...</option>' + optsGestores + '</select>' +
        '<button class="btn-primary btn-sm" onclick="adicionarGestor(\'' + c.id + '\')">+ Vincular</button></div></div>' +
        '<div class="condo-inner-panel" id="panel-leitores-' + c.id + '">' +
        '<div class="gestores-inner" id="leitores-inner-' + c.id + '"><p class="loading-msg" style="padding:12px">Carregando...</p></div>' +
        '<div class="gestores-add"><select id="select-leitor-' + c.id + '" class="gestor-select"><option value="">Adicionar leitor...</option>' + optsLeitores + '</select>' +
        '<button class="btn-primary btn-sm" onclick="adicionarLeitor(\'' + c.id + '\')">+ Vincular</button></div></div>' +
        '</div></div>';
    }).join('');
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function preencherSelectCondos() {
  try {
    const condos = await API.condominios.listar();
    const opts   = condos.map(c => '<option value="' + c.id + '">' + c.nome + '</option>').join('');
    ['unidade-condo-id','medidor-condo-id','filtro-unidade-condo','filtro-medidor-condo','rel-unidade','rel-unidade-periodo'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const placeholder = id.startsWith('filtro') ? 'Selecione um condomínio...' : 'Selecione o condomínio...';
      sel.innerHTML = '<option value="">' + placeholder + '</option>' + opts;
    });
  } catch {}
}

async function toggleCondo(condoId) {
  const painel  = document.getElementById('gestores-' + condoId);
  const chevron = document.querySelector('#condo-card-' + condoId + ' .condo-chevron');
  const aberto  = painel.style.display !== 'none';
  if (aberto) { painel.style.display = 'none'; chevron.style.transform = ''; }
  else {
    painel.style.display = 'block'; chevron.style.transform = 'rotate(180deg)';
    await Promise.all([carregarGestoresCondo(condoId), carregarLeitoresCondo(condoId)]);
  }
}

function switchCondoTab(condoId, tab) {
  const tabs   = document.querySelectorAll('#condo-card-' + condoId + ' .condo-inner-tab');
  const panels = document.querySelectorAll('#condo-card-' + condoId + ' .condo-inner-panel');
  tabs.forEach((t, i)   => t.classList.toggle('active', i === (tab === 'gestores' ? 0 : 1)));
  panels.forEach((p, i) => p.classList.toggle('active', i === (tab === 'gestores' ? 0 : 1)));
}

async function carregarGestoresCondo(condoId) {
  const el = document.getElementById('gestores-inner-' + condoId);
  try {
    const condo   = await API.condominios.buscar(condoId);
    const gestores = condo.gestores || [];
    if (!gestores.length) { el.innerHTML = '<p style="padding:10px 14px;font-size:13px;color:var(--text3)">Nenhum gestor vinculado.</p>'; return; }
    el.innerHTML = gestores.map(g =>
      '<div class="gestor-item"><div><span class="gestor-nome">' + g.user.nome + '</span><span class="gestor-email">' + g.user.email + '</span></div>' +
      '<button class="btn-remover-gestor" onclick="removerGestor(\'' + condoId + '\',\'' + g.user.id + '\',\'' + g.user.nome.replace(/'/g,'') + '\')" title="Remover">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>'
    ).join('');
  } catch { el.innerHTML = '<p style="padding:10px;color:var(--danger);font-size:13px">Erro ao carregar.</p>'; }
}

async function carregarLeitoresCondo(condoId) {
  const el = document.getElementById('leitores-inner-' + condoId);
  try {
    const condo   = await API.condominios.buscar(condoId);
    const leitores = condo.leitores || [];
    if (!leitores.length) { el.innerHTML = '<p style="padding:10px 14px;font-size:13px;color:var(--text3)">Nenhum leitor vinculado.</p>'; return; }
    el.innerHTML = leitores.map(l =>
      '<div class="gestor-item"><div><span class="gestor-nome">' + l.user.nome + '</span><span class="gestor-email">' + l.user.email + '</span></div>' +
      '<button class="btn-remover-gestor" onclick="removerLeitor(\'' + condoId + '\',\'' + l.user.id + '\',\'' + l.user.nome.replace(/'/g,'') + '\')" title="Remover">' +
      '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>'
    ).join('');
  } catch { el.innerHTML = '<p style="padding:10px;color:var(--danger);font-size:13px">Erro ao carregar.</p>'; }
}

async function carregarUnidadesAdmin(condoId) {
  await preencherSelectCondos();
  const el = document.getElementById('admin-unidades-list');
  if (!condoId) { el.innerHTML = '<p class="empty-msg">Selecione um condomínio acima para ver as unidades.</p>'; return; }
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';
  try {
    const unidades = await API.get('/unidades?condominio_id=' + condoId);
    el.innerHTML = unidades.map(u =>
      '<div class="list-item">' +
      '<div class="list-item-info">' +
      '<span class="list-item-title">' + (u.bloco ? u.bloco + ' · ' : '') + u.identificador + '</span>' +
      '<span class="list-item-sub">' + (u.empresa || '<em>Sem empresa</em>') + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<span class="badge badge-pend">' + (u.medidores?.length || 0) + ' med.</span>' +
      '<button class="btn-icon btn-edit-unidade" style="padding:4px 8px;font-size:12px" data-id="' + u.id + '" data-bloco="' + (u.bloco||'') + '" data-ident="' + u.identificador + '" data-empresa="' + (u.empresa||'') + '" data-condo="' + condoId + '" title="Editar">✏️</button>' +
      '</div></div>'
    ).join('') || '<p class="empty-msg">Nenhuma unidade neste condomínio.</p>';
    el.querySelectorAll('.btn-edit-unidade').forEach(btn => {
      btn.addEventListener('click', () => editarUnidade(btn.dataset.id, btn.dataset.bloco, btn.dataset.ident, btn.dataset.empresa, btn.dataset.condo));
    });
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarMedidoresAdmin(condoId) {
  const el = document.getElementById('admin-medidores-list');
  if (!condoId) { el.innerHTML = '<p class="empty-msg">Selecione um condomínio acima para ver os medidores.</p>'; return; }
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';
  try {
    const medidores = await API.get('/medidores?condominio_id=' + condoId);
    const tipoLabel = { AGUA:'Água', ENERGIA:'Energia', GAS:'Gás' };
    el.innerHTML = medidores.map(m =>
      '<div class="list-item">' +
      '<div class="list-item-info">' +
      '<span class="list-item-title">' + (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') + (m.unidade?.identificador || '—') + '</span>' +
      '<span class="list-item-sub">' + (tipoLabel[m.tipo] || m.tipo) + ' · ' + (m.numero_serie || 'sem série') + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<span class="badge badge-role-leitor">' + (tipoLabel[m.tipo] || m.tipo) + '</span>' +
      '<button class="btn-icon btn-edit-medidor" style="padding:4px 8px;font-size:12px" data-id="' + m.id + '" data-tipo="' + m.tipo + '" data-serie="' + (m.numero_serie||'') + '" data-local="' + (m.localizacao||'') + '" data-casas="' + (m.casas_decimais||3) + '" data-condo="' + condoId + '" title="Editar">✏️</button>' +
      '</div></div>'
    ).join('') || '<p class="empty-msg">Nenhum medidor neste condomínio.</p>';
    el.querySelectorAll('.btn-edit-medidor').forEach(btn => {
      btn.addEventListener('click', () => editarMedidor(btn.dataset.id, btn.dataset.tipo, btn.dataset.serie, btn.dataset.local, btn.dataset.casas, btn.dataset.condo));
    });
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarUsersAdmin() {
  const el = document.getElementById('admin-users-list');
  try {
    const users = await API.users.listar();
    el.innerHTML = users.map(u =>
      '<div class="list-item">' +
      '<div class="list-item-info"><span class="list-item-title">' + u.nome + '</span><span class="list-item-sub">' + u.email + '</span></div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<span class="badge badge-role-' + u.role.toLowerCase() + '">' + u.role + '</span>' +
      '<button class="btn-icon btn-edit-user" style="padding:4px 8px;font-size:12px" data-id="' + u.id + '" data-nome="' + u.nome + '" data-role="' + u.role + '" title="Editar">✏️</button>' +
      '</div></div>'
    ).join('') || '<p class="empty-msg">Nenhum usuário.</p>';
    el.querySelectorAll('.btn-edit-user').forEach(btn => {
      btn.addEventListener('click', () => editarUsuario(btn.dataset.id, btn.dataset.nome, btn.dataset.role));
    });
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

// ── MODAL ─────────────────────────────────────────────
function abrirModal({ icone, titulo, msg, tipo, onConfirm }) {
  document.getElementById('modalIcon').textContent  = icone;
  document.getElementById('modalTitle').textContent = titulo;
  document.getElementById('modalMsg').textContent   = msg;
  const btn = document.getElementById('modalConfirm');
  btn.className   = 'btn-confirm' + (tipo === 'danger' ? ' danger' : '');
  btn.textContent = tipo === 'danger' ? 'Sim, excluir' : 'Confirmar';
  btn.onclick     = async () => { fecharModal(); await onConfirm(); };
  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById('modal').classList.add('open');
}

function fecharModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.getElementById('modal').classList.remove('open');
}

// ── GESTORES / LEITORES ───────────────────────────────
async function adicionarGestor(condoId) {
  const sel    = document.getElementById('select-gestor-' + condoId);
  const userId = sel.value;
  const nome   = sel.options[sel.selectedIndex]?.text || '';
  if (!userId) { toast('Selecione um gestor.', 'warn'); return; }
  const condoEl = document.querySelector('#condo-card-' + condoId + ' .list-item-title');
  abrirModal({ icone: '🔗', titulo: 'Vincular gestor',
    msg: 'Deseja vincular "' + nome + '" ao condomínio "' + (condoEl?.textContent || '') + '"?',
    tipo: 'normal',
    onConfirm: async () => {
      try { await API.post('/condominios/' + condoId + '/gestores', { user_id: userId }); toast('Gestor vinculado!', 'ok'); sel.value = ''; await carregarGestoresCondo(condoId); }
      catch (err) { toast(err.message, 'erro'); }
    }
  });
}

async function removerGestor(condoId, userId, nomeGestor) {
  abrirModal({ icone: '⚠️', titulo: 'Remover gestor',
    msg: 'Deseja remover "' + nomeGestor + '" do condomínio? Ele perderá o acesso imediatamente.',
    tipo: 'danger',
    onConfirm: async () => {
      try { await API.delete('/condominios/' + condoId + '/gestores/' + userId); toast('Gestor removido.', 'ok'); await carregarGestoresCondo(condoId); }
      catch (err) { toast(err.message, 'erro'); }
    }
  });
}

async function adicionarLeitor(condoId) {
  const sel    = document.getElementById('select-leitor-' + condoId);
  const userId = sel.value;
  const nome   = sel.options[sel.selectedIndex]?.text || '';
  if (!userId) { toast('Selecione um leitor.', 'warn'); return; }
  const condoEl = document.querySelector('#condo-card-' + condoId + ' .list-item-title');
  abrirModal({ icone: '🔗', titulo: 'Vincular leitor',
    msg: 'Deseja vincular "' + nome + '" ao condomínio "' + (condoEl?.textContent || '') + '"?',
    tipo: 'normal',
    onConfirm: async () => {
      try { await API.post('/condominios/' + condoId + '/leitores', { user_id: userId }); toast('Leitor vinculado!', 'ok'); sel.value = ''; await carregarLeitoresCondo(condoId); }
      catch (err) { toast(err.message, 'erro'); }
    }
  });
}

async function removerLeitor(condoId, userId, nomeLeitor) {
  abrirModal({ icone: '⚠️', titulo: 'Remover leitor',
    msg: 'Deseja remover "' + nomeLeitor + '" do condomínio? Ele perderá o acesso imediatamente.',
    tipo: 'danger',
    onConfirm: async () => {
      try { await API.delete('/condominios/' + condoId + '/leitores/' + userId); toast('Leitor removido.', 'ok'); await carregarLeitoresCondo(condoId); }
      catch (err) { toast(err.message, 'erro'); }
    }
  });
}

// ── FORMS ADMIN ───────────────────────────────────────
document.getElementById('form-novo-condo')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.condominios.criar({ nome: document.getElementById('condo-nome').value, endereco: document.getElementById('condo-endereco').value, cidade: document.getElementById('condo-cidade').value });
    toast('Condomínio criado!', 'ok'); e.target.reset(); carregarCondosAdmin(); preencherSelectCondos();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-nova-unidade')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.unidades.criar({ condominio_id: document.getElementById('unidade-condo-id').value, identificador: document.getElementById('unidade-ident').value, bloco: document.getElementById('unidade-bloco').value, empresa: document.getElementById('unidade-empresa').value });
    toast('Unidade criada!', 'ok'); e.target.reset(); carregarUnidadesAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-novo-medidor')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.medidores.criar({ unidade_id: document.getElementById('medidor-unidade-id').value, tipo: document.getElementById('medidor-tipo').value, numero_serie: document.getElementById('medidor-serie').value, localizacao: document.getElementById('medidor-local').value, casas_decimais: document.getElementById('medidor-casas').value });
    toast('Medidor criado!', 'ok'); e.target.reset(); carregarMedidoresAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-novo-user')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.users.criar({ nome: document.getElementById('user-nome').value, email: document.getElementById('user-email').value, senha: document.getElementById('user-senha').value, role: document.getElementById('user-role').value });
    toast('Usuário criado!', 'ok'); e.target.reset(); carregarUsersAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('medidor-condo-id')?.addEventListener('change', async function() {
  const condoId = this.value;
  const sel     = document.getElementById('medidor-unidade-id');
  sel.innerHTML = '<option value="">Carregando...</option>';
  if (!condoId) { sel.innerHTML = '<option value="">Selecione a unidade...</option>'; return; }
  try {
    const unidades = await API.unidades.listar(condoId);
    sel.innerHTML = '<option value="">Selecione a unidade...</option>' +
      unidades.map(u => '<option value="' + u.id + '">' + (u.bloco ? u.bloco + ' · ' : '') + u.identificador + (u.empresa ? ' — ' + u.empresa : '') + '</option>').join('');
  } catch { sel.innerHTML = '<option value="">Erro ao carregar</option>'; }
});

// ── RELATÓRIOS ───────────────────────────────────────
Views.relatorio = async () => {
  if (!Auth.canManage()) { Router.go('dashboard'); return; }
  const sel = document.getElementById('rel-condo');
  try {
    const condos = await API.condominios.listar();
    sel.innerHTML = condos.map(c => '<option value="' + c.id + '">' + c.nome + '</option>').join('');
    sel.onchange = async () => {
      ['rel-unidade', 'rel-unidade-periodo'].forEach(sid => {
        const s = document.getElementById(sid);
        if (s) s.innerHTML = '<option value="">Todas as unidades</option>';
      });
      if (!sel.value) return;
      try {
        const unidades = await API.get('/unidades?condominio_id=' + sel.value);
        const opts = unidades.map(u =>
          '<option value="' + u.id + '">' + (u.bloco ? u.bloco + ' · ' : '') + u.identificador + (u.empresa ? ' — ' + u.empresa : '') + '</option>'
        ).join('');
        ['rel-unidade', 'rel-unidade-periodo'].forEach(sid => {
          const s = document.getElementById(sid);
          if (s) s.innerHTML += opts;
        });
      } catch {}
    };
    if (condos.length) sel.onchange();
  } catch {}

  const agora = new Date();
  document.getElementById('rel-mes').value = agora.getMonth() + 1;
  document.getElementById('rel-ano').value = agora.getFullYear();

  const fim = agora.toISOString().split('T')[0];
  const ini = new Date(agora - 30 * 86400000).toISOString().split('T')[0];
  document.getElementById('rel-inicio').value = ini;
  document.getElementById('rel-fim').value    = fim;

  document.getElementById('rel-resultado').innerHTML = '';
};

function alternarFiltrosRelatorio() {
  const tipo = document.getElementById('rel-tipo').value;
  document.getElementById('rel-filtros-mensal').style.display  = tipo === 'mensal'  ? 'flex' : 'none';
  document.getElementById('rel-filtros-periodo').style.display = tipo === 'periodo' ? 'flex' : 'none';
  document.getElementById('rel-filtros-extrato').style.display = tipo === 'extrato' ? 'block' : 'none';
}

async function gerarRelatorio(formato) {
  const condoId = document.getElementById('rel-condo').value;
  const tipo    = document.getElementById('rel-tipo').value;
  if (!condoId) { toast('Selecione um condomínio.', 'warn'); return; }

  let url;
  if (tipo === 'mensal') {
    const mes = document.getElementById('rel-mes').value;
    const ano = document.getElementById('rel-ano').value;
    url = '/api/relatorios/mensal?condominio_id=' + condoId + '&mes=' + mes + '&ano=' + ano + '&formato=' + formato;
  } else if (tipo === 'extrato') {
    const mes       = document.getElementById('rel-mes').value;
    const ano       = document.getElementById('rel-ano').value;
    const unidadeId = document.getElementById('rel-unidade').value;
    url = '/api/relatorios/extrato?condominio_id=' + condoId + '&mes=' + mes + '&ano=' + ano + '&formato=' + formato;
    if (unidadeId) url += '&unidade_id=' + unidadeId;
  } else {
    const ini         = document.getElementById('rel-inicio').value;
    const fim         = document.getElementById('rel-fim').value;
    if (!ini || !fim) { toast('Preencha as datas.', 'warn'); return; }
    const unidPeriodo = document.getElementById('rel-unidade-periodo')?.value || '';
    url = '/api/relatorios/periodo?condominio_id=' + condoId + '&data_inicio=' + ini + '&data_fim=' + fim + '&formato=' + formato;
    if (unidPeriodo) url += '&unidade_id=' + unidPeriodo;
  }

  if (formato === 'csv' || formato === 'pdf') {
    try {
      const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + Auth.token } });
      if (!resp.ok) { toast('Erro ao gerar arquivo.', 'erro'); return; }
      const blob   = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const link   = document.createElement('a');
      link.href     = objUrl;
      link.download = formato === 'csv' ? 'relatorio.csv' : 'relatorio.pdf';
      link.click();
      URL.revokeObjectURL(objUrl);
    } catch { toast('Erro ao baixar arquivo.', 'erro'); }
    return;
  }

  const el = document.getElementById('rel-resultado');
  el.innerHTML = '<p class="loading-msg">Gerando relatório...</p>';

  try {
    const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + Auth.token } });
    const data = await resp.json();
    if (!resp.ok) { el.innerHTML = '<p class="error-msg">' + (data.erro || 'Erro') + '</p>'; return; }

    if (tipo === 'mensal')        renderRelatorioMensal(el, data);
    else if (tipo === 'extrato')  renderRelatorioExtrato(el, data);
    else                          renderRelatorioPeriodo(el, data);
  } catch (err) {
    el.innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
}

// ── HELPER: card de área comum ────────────────────────
function renderAreaComumCard(areaComum) {
  if (!areaComum) return '';
  const casas    = areaComum.casas_decimais ?? 2;
  const negativo = areaComum.negativo;
  const corValor = negativo ? 'var(--danger)' : 'var(--blue)';
  const alerta   = negativo
    ? '<div style="font-size:11px;color:var(--danger);margin-top:8px">⚠ Valor negativo — verifique as leituras do medidor geral</div>'
    : '';

  return '<div class="rel-area-comum">' +
    '<div class="rel-area-comum-header">Consumo de área comum</div>' +
    '<div class="rel-area-comum-grid">' +
      '<div class="rel-area-comum-item">' +
        '<div class="rel-area-comum-val">' + fmtValor(areaComum.consumo_geral, casas) + ' m³</div>' +
        '<div class="rel-area-comum-label">Medidor geral</div>' +
      '</div>' +
      '<div class="rel-area-comum-sep">−</div>' +
      '<div class="rel-area-comum-item">' +
        '<div class="rel-area-comum-val">' + fmtValor(areaComum.consumo_privativo, casas) + ' m³</div>' +
        '<div class="rel-area-comum-label">Soma privativos</div>' +
      '</div>' +
      '<div class="rel-area-comum-sep">=</div>' +
      '<div class="rel-area-comum-item">' +
        '<div class="rel-area-comum-val" style="color:' + corValor + ';font-size:22px">' +
          fmtValor(areaComum.consumo_area_comum, casas) + ' m³' +
        '</div>' +
        '<div class="rel-area-comum-label">Área comum</div>' +
      '</div>' +
    '</div>' +
    alerta +
  '</div>';
}

function renderRelatorioMensal(el, data) {
  const nomeMes     = new Date(data.ano, data.mes - 1).toLocaleString('pt-BR', { month: 'long' });
  const casasResumo = data.resumo.casas_decimais ?? 2;

  let html = '<div class="rel-header"><h3>' + nomeMes + ' ' + data.ano + ' — ' + data.condominio + '</h3></div>';
  html += '<div class="rel-resumo">' +
    relCard('Total consumido',   fmtValor(data.resumo.consumo_total_m3, casasResumo) + ' m³') +
    relCard('Medidores lidos',   data.resumo.total_medidores_lidos) +
    relCard('Média por unidade', fmtValor(data.resumo.media_consumo_m3, casasResumo) + ' m³') +
    relCard('Alertas', data.resumo.total_alertas, data.resumo.total_alertas > 0 ? 'warn' : '') +
    '</div>';

  html += renderAreaComumCard(data.area_comum);

  html += '<div class="rel-table-wrap"><table class="rel-table">' +
    '<thead><tr><th>Unidade</th><th>Empresa</th><th>Dias</th><th>1ª Leitura</th><th>Última</th><th>Consumo m³</th><th>Var%</th></tr></thead><tbody>';

  data.leituras.forEach(l => {
    const casas      = l.casas_decimais ?? 2;
    const alerta     = l.alerta ? ' rel-alerta' : '';
    const varStr     = l.variacao_pct !== null ? (l.variacao_pct >= 0 ? '+' : '') + l.variacao_pct + '%' : '—';
    const geralStyle = !l.empresa ? ' style="background:var(--blue-xlight)"' : '';
    html += '<tr class="' + alerta + '"' + geralStyle + '>' +
      '<td><strong>' + (l.bloco ? l.bloco + ' · ' : '') + l.unidade + '</strong></td>' +
      '<td>' + (l.empresa || '<span style="color:var(--text3);font-style:italic">Geral</span>') + '</td>' +
      '<td>' + l.dias_lidos + '</td>' +
      '<td>' + fmtValor(l.primeira_leitura, casas) + '</td>' +
      '<td>' + fmtValor(l.ultima_leitura,   casas) + '</td>' +
      '<td><strong>' + fmtValor(l.consumo_m3, casas) + '</strong></td>' +
      '<td class="' + (l.alerta ? 'text-danger' : '') + '">' + varStr + '</td></tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function renderRelatorioPeriodo(el, data) {
  const r           = data.resumo || {};
  const casasResumo = r.casas_decimais ?? 2;

  let html = '<div class="rel-header"><h3>Leituras — ' + data.condominio + '</h3>' +
  '<p>' + parseDateBR(data.data_inicio) + ' a ' + parseDateBR(data.data_fim) + '</p></div>';


  html += '<div class="rel-resumo">' +
    relCard('Total de leituras',  r.total_leituras || 0) +
    relCard('Consumo no período', fmtValor(r.consumo_total_m3 || 0, casasResumo) + ' m³') +
    relCard('Alertas',            r.total_alertas  || 0, r.total_alertas > 0 ? 'warn' : '') +
    '</div>';

  html += renderAreaComumCard(data.area_comum);

  if (data.acumulado && data.acumulado.length) {
    html += '<div style="margin-bottom:16px">' +
      '<div class="section-title" style="padding:0 0 8px;font-size:11px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:1px">Acumulado por unidade</div>' +
      '<div class="rel-table-wrap"><table class="rel-table">' +
      '<thead><tr><th>Unidade</th><th>Empresa</th><th>Consumo no período</th></tr></thead><tbody>';

   
    data.acumulado.forEach(a => {
  const casas      = a.casas_decimais ?? 2;
  const geralStyle = !a.empresa ? 'background:var(--blue-xlight)' : '';
  const alertStyle = a.alerta ? 'background:#fff7ed;border-left:3px solid #f97316' : '';
  const rowStyle   = ' style="' + (alertStyle || geralStyle) + '"';
  const alertaIcon = a.alerta ? ' <span style="color:#f97316;font-weight:700" title="Variação acima de 20%">⚠</span>' : '';
  html += '<tr' + rowStyle + '>' +
    '<td><strong>' + (a.bloco ? a.bloco + ' · ' : '') + a.unidade + '</strong></td>' +
    '<td>' + (a.empresa || '<span style="color:var(--text3);font-style:italic">Geral</span>') + alertaIcon + '</td>' +
    '<td><strong>' + fmtValor(a.consumo, casas) + '</strong></td></tr>';
});

    html += '</tbody></table></div></div>';
  }

  html += '<div class="rel-table-wrap"><table class="rel-table">' +
    '<thead><tr><th>Unidade</th><th>Empresa</th><th>Data</th><th>Valor m³</th><th>Variação</th><th>Leitor</th><th>Foto</th></tr></thead><tbody>';

  data.leituras.forEach(l => {
    const casas    = l.casas_decimais ?? 2;
    const alerta   = l.alerta ? ' rel-alerta' : '';
    const dataStr  = diaSemana(l.referencia_dia, l.referencia_mes, l.referencia_ano) + ' ' +
                     String(l.referencia_dia).padStart(2,'0') + '/' +
                     String(l.referencia_mes).padStart(2,'0') + '/' + l.referencia_ano;
    const varNum   = l.variacao !== null ? parseFloat(l.variacao) : null;
    const varStr   = varNum !== null ? fmtVar(varNum, casas) : '—';
    const varStyle = l.alerta
      ? 'class="text-danger"'
      : (varNum !== null && varNum > 0 ? 'style="color:var(--ok);font-weight:600"' : '');
    const fotoHtml    = l.foto_url
      ? '<a href="#" onclick="abrirFoto(\'' + l.foto_url + '\', event);return false;" style="color:var(--blue)">📷</a>'
      : '—';
    const geralStyle  = !l.empresa_snapshot ? ' style="background:var(--blue-xlight)"' : '';

    html += '<tr class="' + alerta + '"' + geralStyle + '>' +
      '<td><strong>' + (l.bloco ? l.bloco + ' · ' : '') + l.unidade + '</strong></td>' +
      '<td>' + (l.empresa_snapshot || '<span style="color:var(--text3);font-style:italic">Geral</span>') + '</td>' +
      '<td>' + dataStr + '</td>' +
      '<td>' + fmtValor(l.valor, casas) + '</td>' +
      '<td ' + varStyle + '>' + varStr + '</td>' +
      '<td>' + l.leitor + '</td>' +
      '<td style="text-align:center">' + fotoHtml + '</td></tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function renderRelatorioExtrato(el, data) {
  const nomeMes = new Date(data.ano, data.mes - 1).toLocaleString('pt-BR', { month: 'long' });
  let html = '<div class="rel-header"><h3>Extrato — ' + data.condominio + '</h3><p>' + nomeMes + ' ' + data.ano + '</p></div>';

  data.extratos.forEach(e => {
    const casas  = e.casas_decimais ?? 2;
    const titulo = (e.bloco ? e.bloco + ' · ' : '') + e.unidade;

    html += '<div class="rel-extrato-bloco">' +
      '<div class="rel-extrato-header">' +
      '<div><strong>' + titulo + '</strong>' +
      (e.empresa ? ' <span style="color:var(--text2);font-weight:400">— ' + e.empresa + '</span>' : '') +
      '</div>' +
      '<div style="font-size:12px;color:var(--text2)">Série: ' + (e.numero_serie || '—') + '</div>' +
      '</div>';

    html += '<div class="rel-table-wrap"><table class="rel-table">' +
      '<thead><tr><th>Data</th><th>Valor m³</th><th>Consumo dia</th><th>Leitor</th><th>Foto</th></tr></thead><tbody>';

    e.linhas.forEach(l => {
      if (l.sem_leitura) {
        html += '<tr style="opacity:.4"><td>' + l.data + ' ' + l.dia_semana +
          '</td><td colspan="4" style="color:var(--text3);font-style:italic">Sem leitura</td></tr>';
      } else {
        html += '<tr>' +
          '<td>' + l.data + ' ' + l.dia_semana + '</td>' +
          '<td><strong>' + fmtValor(l.valor, casas) + '</strong></td>' +
          '<td>' + (l.consumo !== null ? fmtVar(l.consumo, casas) : '—') + '</td>' +
          '<td>' + (l.leitor || '—') + '</td>' +
          '<td>' + (l.tem_foto
            ? '<a href="#" onclick="abrirFoto(\'' + l.foto_url + '\', event);return false;" style="color:var(--blue)">📷 ver</a>'
            : '—') +
          '</td></tr>';
      }
    });

    html += '</tbody><tfoot><tr style="background:var(--blue)">' +
      '<td colspan="2" style="color:white;font-weight:700;padding:8px 10px">CONSUMO TOTAL</td>' +
      '<td style="color:white;font-weight:700;font-family:var(--mono)">' + fmtValor(e.consumo_total, casas) + ' m³</td>' +
      '<td colspan="2" style="color:rgba(255,255,255,.6);font-size:11px">' + e.dias_lidos + ' dias lidos</td>' +
      '</tr></tfoot></table></div></div>';
  });

  el.innerHTML = html || '<p class="empty-msg">Nenhuma leitura no período.</p>';
}

function relCard(label, valor, tipo) {
  const bg    = tipo === 'warn' ? 'var(--warn-bg)' : 'var(--blue-xlight)';
  const color = tipo === 'warn' ? 'var(--warn)'    : 'var(--blue)';
  return '<div class="rel-card" style="background:' + bg + '">' +
    '<div class="rel-card-val" style="color:' + color + '">' + valor + '</div>' +
    '<div class="rel-card-label">' + label + '</div>' +
    '</div>';
}

// ── ACCORDION ────────────────────────────────────────
function toggleAccordion(bodyId) {
  const body = document.getElementById(bodyId);
  const btn  = body.previousElementSibling;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  btn.classList.toggle('open', !open);
}

// ── EDIÇÃO ────────────────────────────────────────────
function fecharModalEdit() {
  document.getElementById('editBackdrop').classList.remove('open');
  document.getElementById('editModal').classList.remove('open');
}

function abrirModalEdit(titulo, bodyHtml, onSave) {
  document.getElementById('editModalTitle').textContent = titulo;
  document.getElementById('editModalBody').innerHTML    = bodyHtml;
  document.getElementById('editModalSave').onclick      = async () => { await onSave(); fecharModalEdit(); };
  document.getElementById('editBackdrop').classList.add('open');
  document.getElementById('editModal').classList.add('open');
}

function editarCondominio(id, nome, endereco, cidade) {
  abrirModalEdit('Editar condomínio',
    '<div class="field"><label>Nome</label><input id="e-condo-nome" value="' + nome + '"></div>' +
    '<div class="field"><label>Endereço</label><input id="e-condo-end" value="' + (endereco||'') + '"></div>' +
    '<div class="field"><label>Cidade</label><input id="e-condo-cid" value="' + (cidade||'') + '"></div>',
    async () => {
      await API.condominios.editar(id, { nome: document.getElementById('e-condo-nome').value, endereco: document.getElementById('e-condo-end').value, cidade: document.getElementById('e-condo-cid').value });
      toast('Condomínio atualizado!', 'ok'); carregarCondosAdmin(); preencherSelectCondos();
    }
  );
}

function editarUnidade(id, bloco, ident, empresa, condoFiltro) {
  abrirModalEdit('Editar unidade',
    '<div class="field"><label>Bloco</label><input id="e-u-bloco" value="' + (bloco||'') + '"></div>' +
    '<div class="field"><label>Identificador</label><input id="e-u-ident" value="' + ident + '" required></div>' +
    '<div class="field"><label>Empresa ocupante</label><input id="e-u-emp" value="' + (empresa||'') + '"></div>',
    async () => {
      await API.put('/unidades/' + id, { bloco: document.getElementById('e-u-bloco').value, identificador: document.getElementById('e-u-ident').value, empresa: document.getElementById('e-u-emp').value });
      toast('Unidade atualizada!', 'ok'); carregarUnidadesAdmin(condoFiltro);
    }
  );
}

function editarMedidor(id, tipo, serie, local, casas, condoFiltro) {
  abrirModalEdit('Editar medidor',
    '<div class="field"><label>Tipo</label><select id="e-m-tipo">' +
    ['AGUA','ENERGIA','GAS'].map(t => '<option value="' + t + '"' + (t===tipo?' selected':'') + '>' + {AGUA:'Água',ENERGIA:'Energia',GAS:'Gás'}[t] + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>Casas decimais</label><select id="e-m-casas">' +
    [0,1,2,3].map(c => '<option value="' + c + '"' + (c==casas?' selected':'') + '>' + c + ' — ' + ['Inteiro','1 decimal','2 decimais','3 decimais'][c] + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>Nº de série</label><input id="e-m-serie" value="' + (serie||'') + '"></div>' +
    '<div class="field"><label>Localização</label><input id="e-m-local" value="' + (local||'') + '"></div>',
    async () => {
      await API.put('/medidores/' + id, { tipo: document.getElementById('e-m-tipo').value, casas_decimais: parseInt(document.getElementById('e-m-casas').value), numero_serie: document.getElementById('e-m-serie').value, localizacao: document.getElementById('e-m-local').value });
      toast('Medidor atualizado!', 'ok'); carregarMedidoresAdmin(condoFiltro);
    }
  );
}

function editarUsuario(id, nome, role) {
  abrirModalEdit('Editar usuário',
    '<div class="field"><label>Nome</label><input id="e-user-nome" value="' + nome + '"></div>' +
    '<div class="field"><label>Perfil</label><select id="e-user-role">' +
    ['LEITOR','GESTOR','ADMIN'].map(r => '<option value="' + r + '"' + (r===role?' selected':'') + '>' + r + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>Nova senha (deixe vazio para manter)</label><input type="password" id="e-user-senha" placeholder="opcional"></div>',
    async () => {
      const data  = { nome: document.getElementById('e-user-nome').value, role: document.getElementById('e-user-role').value };
      const senha = document.getElementById('e-user-senha').value;
      if (senha) data.senha = senha;
      await API.users.editar(id, data);
      toast('Usuário atualizado!', 'ok'); carregarUsersAdmin();
    }
  );
}

async function abrirFoto(fotoUrl, event) {
  if (event) event.preventDefault();
  const url = await resolverFotoUrl(fotoUrl);
  if (url) window.open(url, '_blank');
}

// ── ATALHO: lançamento em massa ───────────────────────
async function irLancamentoMassa() {
  if (!Auth.canManage()) return;

  const condos = _dashCondominios && _dashCondominios.length ? _dashCondominios : null;

  if (condos && condos.length === 1) {
    const condo = condos[0];
    try {
      const meds = await API.get('/medidores?condominio_id=' + condo.id);
      if (meds.length > 0) {
        const m     = meds[0];
        const label = (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') +
                      (m.unidade?.identificador || 'Medidor') +
                      (m.unidade?.empresa ? ' — ' + m.unidade.empresa : '');

        window._historicoCtx = { medidor_id: m.id, medidor_label: label, condominio_id: condo.id, condominio_nome: condo.nome };
        Router.go('historico', { medidor_id: m.id, medidor_label: label, condominio_id: condo.id, condominio_nome: condo.nome });
        setTimeout(() => _historicoSwitchAba('massa'), 300);
        return;
      }
    } catch {}
  }

  Router.go('historico');
  setTimeout(() => { window._historicoAbaInicial = 'massa'; }, 100);
}

// ── GLOBAIS ───────────────────────────────────────────
window.Router                    = Router;
window.abrirHistorico            = abrirHistorico;
window.massaGerarLinhas          = massaGerarLinhas;
window.massaSalvar               = massaSalvar;
window.massaFotoPreview          = massaFotoPreview;
window._historicoSwitchAba       = _historicoSwitchAba;
window.abrirHistoricoBtn         = abrirHistoricoBtn;
window.voltarDeHistorico         = voltarDeHistorico;
window.historicoIniciarEdicao    = historicoIniciarEdicao;
window.historicoFecharEdicao     = historicoFecharEdicao;
window.historicoSalvarEdicao     = historicoSalvarEdicao;
window.historicoConfirmarExclusao = historicoConfirmarExclusao;
window._historicoCarregar        = _historicoCarregar;
window.Auth                      = Auth;
window.switchTab                 = switchTab;
window.switchCondoTab            = switchCondoTab;
window.toggleCondo               = toggleCondo;
window.abrirLeitura              = abrirLeitura;
window.mostrarLeituraExistente   = mostrarLeituraExistente;
window.iniciarEdicao             = iniciarEdicao;
window.confirmarExclusao         = confirmarExclusao;
window.adicionarGestor           = adicionarGestor;
window.removerGestor             = removerGestor;
window.adicionarLeitor           = adicionarLeitor;
window.removerLeitor             = removerLeitor;
window.fecharModal               = fecharModal;
window.voltarDeLeitura           = voltarDeLeitura;
window.carregarUnidadesAdmin     = carregarUnidadesAdmin;
window.carregarMedidoresAdmin    = carregarMedidoresAdmin;
window.toggleAccordion           = toggleAccordion;
window.alternarFiltrosRelatorio  = alternarFiltrosRelatorio;
window.gerarRelatorio            = gerarRelatorio;
window.fecharModalEdit           = fecharModalEdit;
window.editarCondominio          = editarCondominio;
window.editarUnidade             = editarUnidade;
window.editarMedidor             = editarMedidor;
window.editarUsuario             = editarUsuario;
window.atualizarGraficoConsumo   = atualizarGraficoConsumo;
window.atualizarGraficoPeriodo   = atualizarGraficoPeriodo;
window.irLancamentoMassa         = irLancamentoMassa;
window.irRelatorio               = function(tipo) {
  Router.go('relatorio');
  setTimeout(() => {
    const sel = document.getElementById('rel-tipo');
    if (sel) { sel.value = tipo; alternarFiltrosRelatorio(); }
  }, 100);
};
window.abrirFoto = abrirFoto;

document.getElementById('btn-logout')?.addEventListener('click', Auth.logout);
document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', () => Router.go(btn.dataset.page));
});

if (Auth.isLogged()) {
  Router.go(Auth.is('LEITOR') ? 'leitor' : 'dashboard');
} else {
  Router.go('login');
}
