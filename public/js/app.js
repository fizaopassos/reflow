'use strict';

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
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
    if (Auth.isLogged() && page === 'login')  { Router.go('dashboard'); return; }
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
    if (!Auth.isLogged()) { nav.style.display = 'none'; return; }
    nav.style.display = 'flex';
    nav.querySelectorAll('[data-page]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.page === Router.current);
    });
    document.getElementById('nav-admin').style.display = Auth.canAdmin() ? 'flex' : 'none';
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
    Router.go('dashboard');
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

// DASHBOARD
Views.dashboard = async () => {
  const user = Auth.user;
  document.getElementById('topbar-nome').textContent = user?.nome || '';

  const el = document.getElementById('dashboard-cards');
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';

  const agora = new Date();
  const mes = agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  document.getElementById('dashboard-mes').textContent = 'Referência: ' + mes;

  try {
    const data = await API.dashboard();
    if (!data.condominios.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum condomínio disponível.</p>';
      return;
    }
    el.innerHTML = data.condominios.map(c => {
      const pct = c.percentual;
      const badgeClass = pct === 100 ? 'badge-ok' : pct > 50 ? 'badge-warn' : 'badge-pend';
      return '<div class="card card-condo" onclick="Router.go(\'medicoes\',{condominio_id:\'' + c.id + '\',nome:\'' + c.nome.replace(/'/g, '') + '\'})">' +
        '<div class="card-header"><span class="card-title">' + c.nome + '</span>' +
        '<span class="badge ' + badgeClass + '">' + pct + '%</span></div>' +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="card-meta">' +
        '<span>✓ ' + c.lidos + ' lidos</span>' +
        '<span>⏳ ' + c.pendentes + ' pendentes</span>' +
        '<span>Total: ' + c.total_medidores + '</span>' +
        '</div></div>';
    }).join('');
  } catch (err) {
    el.innerHTML = '<p class="error-msg">' + err.message + '</p>';
  }
};

// MEDIÇÕES
Views.medicoes = async ({ condominio_id, nome }) => {
  document.getElementById('medicoes-titulo').textContent = nome || 'Medições';
  document.getElementById('medicoes-sub').textContent = 'Medidores do condomínio';
  const el = document.getElementById('medicoes-grid');
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';

  const agora = new Date();
  const diaHoje = agora.getDate();
  const mesHoje = agora.getMonth() + 1;
  const anoHoje = agora.getFullYear();

  try {
    const [medidores, leituras] = await Promise.all([
      API.get('/medidores?condominio_id=' + condominio_id),
      API.leituras.listar({ condominio_id, mes: mesHoje, ano: anoHoje }),
    ]);

    if (!medidores.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum medidor cadastrado neste condomínio.</p>';
      return;
    }

    // Mapa de leituras
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

    el.innerHTML = medidores.map(m => {
      const { leituraHoje, ultimaLeitura } = mapaLeituras[m.id] || {};
      const tipoIcon = { AGUA: '💧', ENERGIA: '⚡', GAS: '🔥' }[m.tipo] || '📊';
      const badge = leituraHoje
        ? '<span class="badge badge-ok">Hoje ✓</span>'
        : '<span class="badge badge-pend">Pendente hoje</span>';
      const ultimaInfo = ultimaLeitura
        ? '<span>Última: <strong>' + parseFloat(ultimaLeitura.valor).toFixed(3) + ' m³</strong> — ' + new Date(ultimaLeitura.criado_em).toLocaleDateString('pt-BR') + '</span>'
        : '<span style="color:var(--text3)">Sem leituras no mês</span>';
      const titulo = (m.unidade?.bloco ? m.unidade.bloco + ' · ' : '') + (m.unidade?.identificador || '—');
      const empresa = m.unidade?.empresa || '';
      return '<div class="card card-medidor" onclick="abrirLeitura(\'' + m.id + '\',\'' + condominio_id + '\',\'' + nome.replace(/'/g,'') + '\')">' +
        '<div class="card-header"><div>' +
        '<div class="card-title">' + tipoIcon + ' ' + titulo + '</div>' +
        (empresa ? '<div style="font-size:12px;color:var(--text3)">' + empresa + '</div>' : '') +
        '</div>' + badge + '</div>' +
        '<div class="card-meta"><span>Série: ' + (m.numero_serie || '—') + '</span>' + ultimaInfo + '</div>' +
        '</div>';
    }).join('');

    // Armazena dados dos medidores para abrirLeitura
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
    medidor_id: medidorId,
    unidade: dados.unidade || '',
    empresa: dados.empresa || '',
    condominio_id: condoId,
    condominio_nome: condoNome,
  });
}

// LEITURA
Views.leitura = async ({ medidor_id, unidade, empresa, condominio_id, condominio_nome }) => {
  document.getElementById('leitura-unidade').textContent = unidade || 'Medidor';
  const subEl = document.getElementById('leitura-empresa-sub');
  if (subEl) subEl.textContent = empresa || '';

  document.getElementById('leitura-medidor-id').value = medidor_id || '';
  document.getElementById('leitura-id-edicao').value  = '';
  const agora = new Date();
  document.getElementById('leitura-dia').value = agora.getDate();
  document.getElementById('leitura-mes').value = agora.getMonth() + 1;
  document.getElementById('leitura-ano').value = agora.getFullYear();

  // Reset visual
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

  // Verifica se já existe leitura hoje
  if (medidor_id) {
    try {
      const leituraHoje = await API.leituras.buscarDia(medidor_id);
      if (leituraHoje) { mostrarLeituraExistente(leituraHoje); return; }
    } catch {}
  }
};

function mostrarLeituraExistente(leitura) {
  const el = document.getElementById('leitura-existente');
  const canEdit = Auth.canManage();
  const editadoPor = leitura.editado_por ? ' · editado por ' + leitura.editado_por.nome : '';

  // Mostra foto
  if (leitura.foto_url) {
    document.getElementById('captureZone').style.display     = 'block';
    document.getElementById('leitura-preview').src           = leitura.foto_url;
    document.getElementById('leitura-preview').style.display = 'block';
    document.getElementById('leitura-idle').style.display    = 'none';
  }

  // Bloqueia câmera para leitor
  document.getElementById('leitura-file').disabled           = !canEdit;
  document.getElementById('captureZone').style.cursor        = canEdit ? 'pointer' : 'default';
  document.getElementById('captureZone').style.pointerEvents = canEdit ? 'auto' : 'none';

  const obsHtml = leitura.observacoes ? '<div class="result-obs" style="margin-top:8px">' + leitura.observacoes + '</div>' : '';
  const editBtn = canEdit
    ? '<div style="margin-top:14px"><button class="btn-secondary btn-sm" onclick="iniciarEdicao(\'' + leitura.id + '\',' + parseFloat(leitura.valor) + ',\'' + (leitura.observacoes || '').replace(/'/g,'') + '\')">✏️ Editar leitura</button></div>'
    : '<div style="font-size:12px;color:var(--text3);margin-top:10px">Somente gestor ou admin pode editar.</div>';

  el.innerHTML = '<div class="leitura-existente-card">' +
    '<div style="font-size:11px;font-weight:700;color:var(--ok);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">✓ Leitura registrada hoje</div>' +
    '<div class="result-valor" style="font-size:38px">' + parseFloat(leitura.valor).toFixed(3) + ' m³</div>' +
    '<div style="font-size:13px;color:var(--text2);margin-top:6px">Registrado por ' + leitura.user.nome + editadoPor + '</div>' +
    obsHtml + editBtn + '</div>';
  el.style.display = 'block';

  document.getElementById('form-leitura').style.display = 'none';
  if (!leitura.foto_url) document.getElementById('captureZone').style.display = 'none';
}

function iniciarEdicao(leituraId, valorAtual, obsAtual) {
  document.getElementById('leitura-existente').style.display  = 'none';
  document.getElementById('leitura-id-edicao').value          = leituraId;
  document.getElementById('leitura-valor-input').value        = valorAtual;
  document.getElementById('leitura-obs-input').value          = obsAtual || '';
  document.getElementById('form-leitura').style.display       = 'flex';
  document.getElementById('form-leitura-submit').textContent  = '💾 Salvar alteração';
  document.getElementById('captureZone').style.display        = 'none';
  document.getElementById('leitura-valor-input').focus();
}

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

  const valorNum = parseFloat(valor);
  if (!valor || isNaN(valorNum) || valorNum < 0) { toast('Digite um valor válido.', 'warn'); return; }
  if (valorNum >= 9999999) { toast('Valor muito alto. Verifique se digitou certo.', 'warn'); return; }

  btn.disabled = true;
  try {
    if (leituraId) {
      const obs = document.getElementById('leitura-obs-input')?.value;
      await API.leituras.editar(leituraId, { valor, observacoes: obs });
      toast('✓ Leitura atualizada!', 'ok');
    } else {
      if (!file) { toast('Foto obrigatória. Fotografe o medidor.', 'warn'); btn.disabled = false; return; }
      const obs = document.getElementById('leitura-obs-input')?.value;
      const form = new FormData();
      form.append('medidor_id', medidor_id);
      form.append('valor', valor);
      form.append('referencia_dia', dia);
      form.append('referencia_mes', mes);
      form.append('referencia_ano', ano);
      form.append('metodo', 'MANUAL');
      form.append('observacoes', obs || '');
      form.append('imagem', file);
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

// ── ADMIN TABS ────────────────────────────────────────
function switchTab(name) {
  const tabs  = ['condos','unidades','medidores','users'];
  document.querySelectorAll('.admin-tab').forEach((t, i) => t.classList.toggle('active', tabs[i] === name));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'users') carregarUsersAdmin();
  // Unidades e medidores só carregam após seleção de condomínio
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
    const leitores  = users.filter(u => u.role === 'LEITOR'  && u.ativo);

    if (!condos.length) { el.innerHTML = '<p class="empty-msg">Nenhum condomínio.</p>'; return; }

    el.innerHTML = condos.map(c => {
      const optsGestores = gestores.map(g => '<option value="' + g.id + '">' + g.nome + ' (' + g.email + ')</option>').join('');
      const optsLeitores  = leitores.map(l  => '<option value="' + l.id  + '">' + l.nome  + ' (' + l.email  + ')</option>').join('');
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
    // Bind condo edit buttons
    el.querySelectorAll('.btn-edit-condo').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        editarCondominio(btn.dataset.id, btn.dataset.nome, btn.dataset.end, btn.dataset.cid);
      });
    });
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function preencherSelectCondos() {
  try {
    const condos = await API.condominios.listar();
    const opts = condos.map(c => '<option value="' + c.id + '">' + c.nome + '</option>').join('');
    ['unidade-condo-id', 'medidor-condo-id', 'filtro-unidade-condo', 'filtro-medidor-condo'].forEach(id => {
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
  if (!condoId) {
    el.innerHTML = '<p class="empty-msg">Selecione um condomínio acima para ver as unidades.</p>';
    return;
  }
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
      '<button class="btn-icon btn-edit-unidade" style="padding:4px 8px;font-size:12px"' +
      ' data-id="' + u.id + '"' +
      ' data-bloco="' + (u.bloco||'') + '"' +
      ' data-ident="' + u.identificador + '"' +
      ' data-empresa="' + (u.empresa||'') + '"' +
      ' data-condo="' + condoId + '"' +
      ' title="Editar">✏️</button>' +
      '</div></div>'
    ).join('') || '<p class="empty-msg">Nenhuma unidade neste condomínio.</p>';
    // Bind edit buttons
    el.querySelectorAll('.btn-edit-unidade').forEach(btn => {
      btn.addEventListener('click', () => editarUnidade(btn.dataset.id, btn.dataset.bloco, btn.dataset.ident, btn.dataset.empresa, btn.dataset.condo));
    });
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarMedidoresAdmin(condoId) {
  const el = document.getElementById('admin-medidores-list');
  if (!condoId) {
    el.innerHTML = '<p class="empty-msg">Selecione um condomínio acima para ver os medidores.</p>';
    return;
  }
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
      '<button class="btn-icon btn-edit-medidor" style="padding:4px 8px;font-size:12px"' +
      ' data-id="' + m.id + '"' +
      ' data-tipo="' + m.tipo + '"' +
      ' data-serie="' + (m.numero_serie||'') + '"' +
      ' data-local="' + (m.localizacao||'') + '"' +
      ' data-condo="' + condoId + '"' +
      ' title="Editar">✏️</button>' +
      '</div></div>'
    ).join('') || '<p class="empty-msg">Nenhum medidor neste condomínio.</p>';
    // Bind edit buttons
    el.querySelectorAll('.btn-edit-medidor').forEach(btn => {
      btn.addEventListener('click', () => editarMedidor(btn.dataset.id, btn.dataset.tipo, btn.dataset.serie, btn.dataset.local, btn.dataset.condo));
    });
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarUsersAdmin() {
  const el = document.getElementById('admin-users-list');
  try {
    const users = await API.users.listar();
    el.innerHTML = users.map(u =>
      '<div class="list-item">' +
      '<div class="list-item-info">' +
      '<span class="list-item-title">' + u.nome + '</span>' +
      '<span class="list-item-sub">' + u.email + '</span>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:6px">' +
      '<span class="badge badge-role-' + u.role.toLowerCase() + '">' + u.role + '</span>' +
      '<button class="btn-icon btn-edit-user" style="padding:4px 8px;font-size:12px"' +
      ' data-id="' + u.id + '"' +
      ' data-nome="' + u.nome + '"' +
      ' data-role="' + u.role + '"' +
      ' title="Editar">✏️</button>' +
      '</div></div>'
    ).join('') || '<p class="empty-msg">Nenhum usuário.</p>';
    // Bind edit buttons
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
  btn.textContent = tipo === 'danger' ? 'Sim, remover' : 'Confirmar';
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
  const sel = document.getElementById('select-gestor-' + condoId);
  const userId = sel.value;
  const nome = sel.options[sel.selectedIndex]?.text || '';
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
  const sel = document.getElementById('select-leitor-' + condoId);
  const userId = sel.value;
  const nome = sel.options[sel.selectedIndex]?.text || '';
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
    await API.medidores.criar({ unidade_id: document.getElementById('medidor-unidade-id').value, tipo: document.getElementById('medidor-tipo').value, numero_serie: document.getElementById('medidor-serie').value, localizacao: document.getElementById('medidor-local').value });
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
  const sel = document.getElementById('medidor-unidade-id');
  sel.innerHTML = '<option value="">Carregando...</option>';
  if (!condoId) { sel.innerHTML = '<option value="">Selecione a unidade...</option>'; return; }
  try {
    const unidades = await API.unidades.listar(condoId);
    sel.innerHTML = '<option value="">Selecione a unidade...</option>' +
      unidades.map(u => '<option value="' + u.id + '">' + (u.bloco ? u.bloco + ' · ' : '') + u.identificador + (u.empresa ? ' — ' + u.empresa : '') + '</option>').join('');
  } catch { sel.innerHTML = '<option value="">Erro ao carregar</option>'; }
});

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
      await API.condominios.editar(id, {
        nome:     document.getElementById('e-condo-nome').value,
        endereco: document.getElementById('e-condo-end').value,
        cidade:   document.getElementById('e-condo-cid').value,
      });
      toast('Condomínio atualizado!', 'ok');
      carregarCondosAdmin();
      preencherSelectCondos();
    }
  );
}

function editarUnidade(id, bloco, ident, empresa, condoFiltro) {
  abrirModalEdit('Editar unidade',
    '<div class="field"><label>Bloco</label><input id="e-u-bloco" value="' + (bloco||'') + '"></div>' +
    '<div class="field"><label>Identificador</label><input id="e-u-ident" value="' + ident + '" required></div>' +
    '<div class="field"><label>Empresa ocupante</label><input id="e-u-emp" value="' + (empresa||'') + '"></div>',
    async () => {
      await API.put('/unidades/' + id, {
        bloco:         document.getElementById('e-u-bloco').value,
        identificador: document.getElementById('e-u-ident').value,
        empresa:       document.getElementById('e-u-emp').value,
      });
      toast('Unidade atualizada!', 'ok');
      carregarUnidadesAdmin(condoFiltro);
    }
  );
}

function editarMedidor(id, tipo, serie, local, condoFiltro) {
  abrirModalEdit('Editar medidor',
    '<div class="field"><label>Tipo</label><select id="e-m-tipo">' +
    ['AGUA','ENERGIA','GAS'].map(t => '<option value="' + t + '"' + (t===tipo?' selected':'') + '>' + {AGUA:'Água',ENERGIA:'Energia',GAS:'Gás'}[t] + '</option>').join('') +
    '</select></div>' +
    '<div class="field"><label>Nº de série</label><input id="e-m-serie" value="' + (serie||'') + '"></div>' +
    '<div class="field"><label>Localização</label><input id="e-m-local" value="' + (local||'') + '"></div>',
    async () => {
      await API.put('/medidores/' + id, {
        tipo:        document.getElementById('e-m-tipo').value,
        numero_serie: document.getElementById('e-m-serie').value,
        localizacao: document.getElementById('e-m-local').value,
      });
      toast('Medidor atualizado!', 'ok');
      carregarMedidoresAdmin(condoFiltro);
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
      const data = {
        nome:  document.getElementById('e-user-nome').value,
        role:  document.getElementById('e-user-role').value,
      };
      const senha = document.getElementById('e-user-senha').value;
      if (senha) data.senha = senha;
      await API.users.editar(id, data);
      toast('Usuário atualizado!', 'ok');
      carregarUsersAdmin();
    }
  );
}

// ── GLOBAIS ───────────────────────────────────────────
window.Router              = Router;
window.Auth                = Auth;
window.switchTab           = switchTab;
window.switchCondoTab      = switchCondoTab;
window.toggleCondo         = toggleCondo;
window.abrirLeitura        = abrirLeitura;
window.mostrarLeituraExistente = mostrarLeituraExistente;
window.iniciarEdicao       = iniciarEdicao;
window.adicionarGestor     = adicionarGestor;
window.removerGestor       = removerGestor;
window.adicionarLeitor     = adicionarLeitor;
window.removerLeitor       = removerLeitor;
window.fecharModal         = fecharModal;
window.voltarDeLeitura     = voltarDeLeitura;
window.carregarUnidadesAdmin  = carregarUnidadesAdmin;
window.toggleAccordion        = toggleAccordion;
window.fecharModalEdit        = fecharModalEdit;
window.editarCondominio       = editarCondominio;
window.editarUnidade          = editarUnidade;
window.editarMedidor          = editarMedidor;
window.editarUsuario          = editarUsuario;
window.carregarMedidoresAdmin = carregarMedidoresAdmin;

document.getElementById('btn-logout')?.addEventListener('click', Auth.logout);
document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', () => Router.go(btn.dataset.page));
});

Router.go(Auth.isLogged() ? 'dashboard' : 'login');
