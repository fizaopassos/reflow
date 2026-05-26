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
  el.className = `toast show ${tipo}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── ROUTER ────────────────────────────────────────────
const Router = {
  current: null,
  params: {},
  go(page, params = {}) {
    if (!Auth.isLogged() && page !== 'login') { Router.go('login'); return; }
    if (Auth.isLogged() && page === 'login')  { Router.go('dashboard'); return; }
    Router.current = page;
    Router.params  = params;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(`view-${page}`);
    if (view) view.classList.add('active');
    Navbar.render();
    Views[page]?.(params);
  }
};

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
  document.getElementById('dashboard-mes').textContent = `Referência: ${mes}`;

  try {
    const data = await API.dashboard();
    if (!data.condominios.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum condomínio disponível.</p>';
      return;
    }
    el.innerHTML = data.condominios.map(c => `
      <div class="card card-condo" onclick="Router.go('medicoes',{condominio_id:'${c.id}',nome:'${c.nome}'})">
        <div class="card-header">
          <span class="card-title">${c.nome}</span>
          <span class="badge ${c.percentual===100?'badge-ok':c.percentual>50?'badge-warn':'badge-pend'}">${c.percentual}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${c.percentual}%"></div></div>
        <div class="card-meta">
          <span>✓ ${c.lidos} lidos</span>
          <span>⏳ ${c.pendentes} pendentes</span>
          <span>Total: ${c.total_medidores}</span>
        </div>
      </div>`).join('');
  } catch (err) {
    el.innerHTML = `<p class="error-msg">${err.message}</p>`;
  }
};

// MEDIÇÕES
Views.medicoes = async ({ condominio_id, nome }) => {
  document.getElementById('medicoes-titulo').textContent = nome || 'Medições';
  document.getElementById('medicoes-sub').textContent = 'Medidores do condomínio';
  const el = document.getElementById('medicoes-grid');
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';

  const agora = new Date();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  try {
    const [medidores, leituras] = await Promise.all([
      API.get(`/medidores?condominio_id=${condominio_id}`),
      API.leituras.listar({ condominio_id, mes, ano }),
    ]);

    if (!medidores.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum medidor cadastrado neste condomínio.</p>';
      return;
    }

    const leiturasMap = {};
    leituras.forEach(l => { leiturasMap[l.medidor_id] = l; });

    el.innerHTML = medidores.map(m => {
      const leitura = leiturasMap[m.id];
      const feita = !!leitura;
      const tipoIcon = { AGUA: '💧', ENERGIA: '⚡', GAS: '🔥' }[m.tipo] || '📊';
      return `
        <div class="card card-medidor ${feita?'feito':'pendente'}"
             onclick="Router.go('leitura',{medidor_id:'${m.id}',unidade:'${m.unidade?.identificador||''}',feita:${feita}})">
          <div class="card-header">
            <div>
              <div class="card-title">${tipoIcon} ${m.unidade?.identificador || '—'}</div>
              ${m.unidade?.andar ? `<div style="font-size:12px;color:var(--text3)">${m.unidade.andar}${m.unidade.bloco ? ' · ' + m.unidade.bloco : ''}</div>` : ''}
            </div>
            <span class="badge ${feita?'badge-ok':'badge-pend'}">${feita?'Lido':'Pendente'}</span>
          </div>
          <div class="card-meta">
            <span>Série: ${m.numero_serie || '—'}</span>
            ${leitura ? `<span>Leitura: <strong>${leitura.valor} m³</strong></span><span>${new Date(leitura.criado_em).toLocaleDateString('pt-BR')}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<p class="error-msg">${err.message}</p>`;
  }
};

// LEITURA
Views.leitura = async ({ medidor_id, unidade }) => {
  document.getElementById('leitura-unidade').textContent = unidade || 'Medidor';
  document.getElementById('leitura-medidor-id').value = medidor_id || '';
  const agora = new Date();
  document.getElementById('leitura-dia').value = agora.getDate();
  document.getElementById('leitura-mes').value = agora.getMonth() + 1;
  document.getElementById('leitura-ano').value = agora.getFullYear();

  // Reset visual
  document.getElementById('leitura-preview').style.display    = 'none';
  document.getElementById('leitura-idle').style.display       = 'flex';
  document.getElementById('form-leitura').style.display       = 'flex';
  document.getElementById('leitura-existente').style.display  = 'none';
  document.getElementById('leitura-id-edicao').value          = '';
  document.getElementById('leitura-file').value               = '';
  document.getElementById('leitura-valor-input').value        = '';
  document.getElementById('leitura-obs-input').value          = '';

  // Verifica se já existe leitura hoje
  if (medidor_id) {
    try {
      const leituraHoje = await API.leituras.buscarDia(medidor_id);
      if (leituraHoje) {
        mostrarLeituraExistente(leituraHoje);
        return;
      }
    } catch {}
  }
};

function mostrarLeituraExistente(leitura) {
  const el = document.getElementById('leitura-existente');
  const canEdit = Auth.canManage();
  const editadoPor = leitura.editado_por ? ` · editado por ${leitura.editado_por.nome}` : '';

  // Mostra foto se existir
  if (leitura.foto_url) {
    document.getElementById('leitura-preview').src           = leitura.foto_url;
    document.getElementById('leitura-preview').style.display = 'block';
    document.getElementById('leitura-idle').style.display    = 'none';
  }

  el.innerHTML = `
    <div class="leitura-existente-card">
      <div style="font-size:11px;font-weight:700;color:var(--ok);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">
        ✓ Leitura registrada hoje
      </div>
      <div class="result-valor" style="font-size:38px">${parseFloat(leitura.valor).toFixed(3)} m³</div>
      <div style="font-size:13px;color:var(--text2);margin-top:6px">
        Registrado por ${leitura.user.nome}${editadoPor}
      </div>
      ${leitura.observacoes ? `<div class="result-obs" style="margin-top:8px">${leitura.observacoes}</div>` : ''}
      ${canEdit ? `
        <div style="margin-top:14px;display:flex;gap:8px">
          <button class="btn-secondary btn-sm" onclick="iniciarEdicao('${leitura.id}', ${parseFloat(leitura.valor)}, '${leitura.observacoes || ''}')">
            ✏️ Editar leitura
          </button>
        </div>` : '<div style="font-size:12px;color:var(--text3);margin-top:10px">Somente gestor ou admin pode editar.</div>'}
    </div>`;
  el.style.display = 'block';

  // Esconde formulário e zona de captura para leitor
  document.getElementById('form-leitura').style.display   = canEdit ? 'flex' : 'none';
  document.getElementById('captureZone').style.display    = canEdit ? 'block' : 'none';
}

function iniciarEdicao(leituraId, valorAtual, obsAtual = '') {
  document.getElementById('leitura-existente').style.display  = 'none';
  document.getElementById('leitura-id-edicao').value          = leituraId;
  document.getElementById('leitura-valor-input').value        = valorAtual;
  document.getElementById('leitura-obs-input').value          = obsAtual;
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
  document.getElementById('form-leitura').style.display    = 'flex';
  document.getElementById('leitura-valor-input').focus();
});

function mostrarFormConfirmar() {
  document.getElementById('form-leitura').style.display = 'flex';
}

function mostrarFormManual() {
  document.getElementById('leitura-valor-input').value = '';
  document.getElementById('form-leitura').style.display = 'flex';
}

document.getElementById('form-leitura')?.addEventListener('submit', async e => {
  e.preventDefault();
  const valor      = document.getElementById('leitura-valor-input').value;
  const medidor_id = document.getElementById('leitura-medidor-id').value;
  const dia        = document.getElementById('leitura-dia').value;
  const mes        = document.getElementById('leitura-mes').value;
  const ano        = document.getElementById('leitura-ano').value;
  const file       = document.getElementById('leitura-file').files[0];
  const leituraId  = document.getElementById('leitura-id-edicao').value;

  const btn = document.getElementById('form-leitura-submit');
  btn.disabled = true;

  try {
    if (leituraId) {
      // EDIÇÃO (só gestor/admin chega aqui)
      const obs = document.getElementById('leitura-obs-input')?.value;
      await API.leituras.editar(leituraId, { valor, observacoes: obs });
      toast('✓ Leitura atualizada!', 'ok');
    } else {
      // Foto obrigatória
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
    setTimeout(() => Router.go('dashboard'), 800);
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

// ADMIN TABS
function switchTab(name) {
  document.querySelectorAll('.admin-tab').forEach((t, i) => {
    const tabs = ['condos','unidades','medidores','users'];
    t.classList.toggle('active', tabs[i] === name);
  });
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (name === 'unidades')  carregarUnidadesAdmin();
  if (name === 'medidores') carregarMedidoresAdmin();
  if (name === 'users')     carregarUsersAdmin();
}

Views.admin = async () => {
  if (!Auth.canAdmin()) { Router.go('dashboard'); return; }
  await carregarCondosAdmin();
  await preencherSelectCondos();
};

async function carregarCondosAdmin() {
  const el = document.getElementById('admin-condos-list');
  try {
    const [condos, users] = await Promise.all([
      API.condominios.listar(),
      API.users.listar(),
    ]);
    const gestores = users.filter(u => u.role === 'GESTOR' && u.ativo);
    const leitores = users.filter(u => u.role === 'LEITOR' && u.ativo);

    if (!condos.length) { el.innerHTML = '<p class="empty-msg">Nenhum condomínio.</p>'; return; }

    el.innerHTML = condos.map(c => `
      <div class="condo-card" id="condo-card-${c.id}">
        <div class="list-item condo-header" onclick="toggleCondo('${c.id}')">
          <div class="list-item-info">
            <span class="list-item-title">${c.nome}</span>
            <span class="list-item-sub">${c.endereco || ''}${c.cidade ? ' · ' + c.cidade : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge badge-pend">${c._count?.unidades || 0} unid.</span>
            <svg class="condo-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" style="transition:transform .2s;color:var(--text3)">
              <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
        </div>
        <div class="condo-gestores" id="gestores-${c.id}" style="display:none">
          <div class="condo-inner-tabs">
            <button class="condo-inner-tab active" onclick="switchCondoTab('${c.id}','gestores')">Gestores</button>
            <button class="condo-inner-tab" onclick="switchCondoTab('${c.id}','leitores')">Leitores</button>
          </div>

          <div class="condo-inner-panel active" id="panel-gestores-${c.id}">
            <div class="gestores-inner" id="gestores-inner-${c.id}">
              <p class="loading-msg" style="padding:12px">Carregando...</p>
            </div>
            <div class="gestores-add">
              <select id="select-gestor-${c.id}" class="gestor-select">
                <option value="">Adicionar gestor...</option>
                ${gestores.map(g => `<option value="${g.id}">${g.nome} (${g.email})</option>`).join('')}
              </select>
              <button class="btn-primary btn-sm" onclick="adicionarGestor('${c.id}')">+ Vincular</button>
            </div>
          </div>

          <div class="condo-inner-panel" id="panel-leitores-${c.id}">
            <div class="gestores-inner" id="leitores-inner-${c.id}">
              <p class="loading-msg" style="padding:12px">Carregando...</p>
            </div>
            <div class="gestores-add">
              <select id="select-leitor-${c.id}" class="gestor-select">
                <option value="">Adicionar leitor...</option>
                ${leitores.map(l => `<option value="${l.id}">${l.nome} (${l.email})</option>`).join('')}
              </select>
              <button class="btn-primary btn-sm" onclick="adicionarLeitor('${c.id}')">+ Vincular</button>
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function toggleCondo(condoId) {
  const painel  = document.getElementById(`gestores-${condoId}`);
  const chevron = document.querySelector(`#condo-card-${condoId} .condo-chevron`);
  const aberto  = painel.style.display !== 'none';
  if (aberto) {
    painel.style.display = 'none';
    chevron.style.transform = '';
  } else {
    painel.style.display = 'block';
    chevron.style.transform = 'rotate(180deg)';
    await Promise.all([carregarGestoresCondo(condoId), carregarLeitoresCondo(condoId)]);
  }
}

function switchCondoTab(condoId, tab) {
  const tabs   = document.querySelectorAll(`#condo-card-${condoId} .condo-inner-tab`);
  const panels = document.querySelectorAll(`#condo-card-${condoId} .condo-inner-panel`);
  tabs.forEach((t, i)   => t.classList.toggle('active', i === (tab === 'gestores' ? 0 : 1)));
  panels.forEach((p, i) => p.classList.toggle('active', i === (tab === 'gestores' ? 0 : 1)));
}

async function carregarGestoresCondo(condoId) {
  const el = document.getElementById(`gestores-inner-${condoId}`);
  try {
    const condo = await API.condominios.buscar(condoId);
    const gestores = condo.gestores || [];
    if (!gestores.length) {
      el.innerHTML = '<p style="padding:10px 14px;font-size:13px;color:var(--text3)">Nenhum gestor vinculado.</p>';
      return;
    }
    el.innerHTML = gestores.map(g => `
      <div class="gestor-item">
        <div>
          <span class="gestor-nome">${g.user.nome}</span>
          <span class="gestor-email">${g.user.email}</span>
        </div>
        <button class="btn-remover-gestor" onclick="removerGestor('${condoId}', '${g.user.id}', '${g.user.nome}')" title="Remover gestor">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>`).join('');
  } catch { el.innerHTML = '<p style="padding:10px;color:var(--danger);font-size:13px">Erro ao carregar.</p>'; }
}

// ── MODAL ─────────────────────────────────────────────
function abrirModal({ icone, titulo, msg, tipo = 'normal', onConfirm }) {
  document.getElementById('modalIcon').textContent    = icone;
  document.getElementById('modalTitle').textContent   = titulo;
  document.getElementById('modalMsg').textContent     = msg;
  const btnConfirm = document.getElementById('modalConfirm');
  btnConfirm.className = 'btn-confirm' + (tipo === 'danger' ? ' danger' : '');
  btnConfirm.textContent = tipo === 'danger' ? 'Sim, remover' : 'Confirmar';
  btnConfirm.onclick = async () => { fecharModal(); await onConfirm(); };
  document.getElementById('modalBackdrop').classList.add('open');
  document.getElementById('modal').classList.add('open');
}

function fecharModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  document.getElementById('modal').classList.remove('open');
}

// ── GESTORES ──────────────────────────────────────────
async function adicionarGestor(condoId) {
  const sel = document.getElementById(`select-gestor-${condoId}`);
  const userId = sel.value;
  const nomeGestor = sel.options[sel.selectedIndex]?.text || '';
  if (!userId) { toast('Selecione um gestor.', 'warn'); return; }

  // Busca nome do condomínio
  const condoEl = document.querySelector(`#condo-card-${condoId} .list-item-title`);
  const nomeCondo = condoEl?.textContent || 'este condomínio';

  abrirModal({
    icone: '🔗',
    titulo: 'Vincular gestor',
    msg: `Deseja vincular "${nomeGestor}" ao condomínio "${nomeCondo}"?`,
    tipo: 'normal',
    onConfirm: async () => {
      try {
        await API.post(`/condominios/${condoId}/gestores`, { user_id: userId });
        toast('Gestor vinculado!', 'ok');
        sel.value = '';
        await carregarGestoresCondo(condoId);
      } catch (err) { toast(err.message, 'erro'); }
    }
  });
}

async function removerGestor(condoId, userId, nomeGestor) {
  abrirModal({
    icone: '⚠️',
    titulo: 'Remover gestor',
    msg: `Deseja remover "${nomeGestor || 'este gestor'}" do condomínio? Ele perderá o acesso imediatamente.`,
    tipo: 'danger',
    onConfirm: async () => {
      try {
        await API.delete(`/condominios/${condoId}/gestores/${userId}`);
        toast('Gestor removido.', 'ok');
        await carregarGestoresCondo(condoId);
      } catch (err) { toast(err.message, 'erro'); }
    }
  });
}

async function preencherSelectCondos() {
  try {
    const condos = await API.condominios.listar();
    ['unidade-condo-id','medidor-condo-id'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">Selecione o condomínio...</option>' +
        condos.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    });
  } catch {}
}

document.getElementById('medidor-condo-id')?.addEventListener('change', async function() {
  const condoId = this.value;
  const sel = document.getElementById('medidor-unidade-id');
  sel.innerHTML = '<option value="">Carregando...</option>';
  if (!condoId) { sel.innerHTML = '<option value="">Selecione a unidade...</option>'; return; }
  try {
    const unidades = await API.unidades.listar(condoId);
    sel.innerHTML = '<option value="">Selecione a unidade...</option>' +
      unidades.map(u => `<option value="${u.id}">${u.identificador}${u.andar?' - '+u.andar:''}</option>`).join('');
  } catch { sel.innerHTML = '<option value="">Erro ao carregar</option>'; }
});

async function carregarUnidadesAdmin() {
  await preencherSelectCondos();
  const el = document.getElementById('admin-unidades-list');
  try {
    const unidades = await API.get('/unidades');
    el.innerHTML = unidades.map(u => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="list-item-title">${u.identificador}</span>
          <span class="list-item-sub">${u.condominio?.nome || ''}${u.andar?' · '+u.andar:''}${u.bloco?' · '+u.bloco:''}</span>
        </div>
        <span class="badge badge-pend">${u.medidores?.length||0} med.</span>
      </div>`).join('') || '<p class="empty-msg">Nenhuma unidade.</p>';
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarMedidoresAdmin() {
  const el = document.getElementById('admin-medidores-list');
  try {
    const medidores = await API.get('/medidores');
    const tipoLabel = { AGUA:'Água', ENERGIA:'Energia', GAS:'Gás' };
    el.innerHTML = medidores.map(m => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="list-item-title">${m.unidade?.identificador||'—'}</span>
          <span class="list-item-sub">${m.unidade?.condominio?.nome||''} · ${tipoLabel[m.tipo]||m.tipo} · ${m.numero_serie||'sem série'}</span>
        </div>
        <span class="badge badge-role-leitor">${tipoLabel[m.tipo]||m.tipo}</span>
      </div>`).join('') || '<p class="empty-msg">Nenhum medidor.</p>';
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarUsersAdmin() {
  const el = document.getElementById('admin-users-list');
  try {
    const users = await API.users.listar();
    el.innerHTML = users.map(u => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="list-item-title">${u.nome}</span>
          <span class="list-item-sub">${u.email}</span>
        </div>
        <span class="badge badge-role-${u.role.toLowerCase()}">${u.role}</span>
      </div>`).join('') || '<p class="empty-msg">Nenhum usuário.</p>';
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarLeitoresCondo(condoId) {
  const el = document.getElementById(`leitores-inner-${condoId}`);
  try {
    const condo   = await API.condominios.buscar(condoId);
    const leitores = condo.leitores || [];
    if (!leitores.length) {
      el.innerHTML = '<p style="padding:10px 14px;font-size:13px;color:var(--text3)">Nenhum leitor vinculado.</p>';
      return;
    }
    el.innerHTML = leitores.map(l => `
      <div class="gestor-item">
        <div>
          <span class="gestor-nome">${l.user.nome}</span>
          <span class="gestor-email">${l.user.email}</span>
        </div>
        <button class="btn-remover-gestor" onclick="removerLeitor('${condoId}','${l.user.id}','${l.user.nome}')" title="Remover leitor">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>`).join('');
  } catch { el.innerHTML = '<p style="padding:10px;color:var(--danger);font-size:13px">Erro ao carregar.</p>'; }
}

async function adicionarLeitor(condoId) {
  const sel    = document.getElementById(`select-leitor-${condoId}`);
  const userId = sel.value;
  const nome   = sel.options[sel.selectedIndex]?.text || '';
  if (!userId) { toast('Selecione um leitor.', 'warn'); return; }
  const condoEl  = document.querySelector(`#condo-card-${condoId} .list-item-title`);
  const nomeCondo = condoEl?.textContent || 'este condomínio';
  abrirModal({
    icone: '🔗',
    titulo: 'Vincular leitor',
    msg: `Deseja vincular "${nome}" ao condomínio "${nomeCondo}"?`,
    tipo: 'normal',
    onConfirm: async () => {
      try {
        await API.post(`/condominios/${condoId}/leitores`, { user_id: userId });
        toast('Leitor vinculado!', 'ok');
        sel.value = '';
        await carregarLeitoresCondo(condoId);
      } catch (err) { toast(err.message, 'erro'); }
    }
  });
}

async function removerLeitor(condoId, userId, nomeLeitor) {
  abrirModal({
    icone: '⚠️',
    titulo: 'Remover leitor',
    msg: `Deseja remover "${nomeLeitor || 'este leitor'}" do condomínio? Ele perderá o acesso imediatamente.`,
    tipo: 'danger',
    onConfirm: async () => {
      try {
        await API.delete(`/condominios/${condoId}/leitores/${userId}`);
        toast('Leitor removido.', 'ok');
        await carregarLeitoresCondo(condoId);
      } catch (err) { toast(err.message, 'erro'); }
    }
  });
}

// FORMS ADMIN
document.getElementById('form-novo-condo')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.condominios.criar({
      nome:     document.getElementById('condo-nome').value,
      endereco: document.getElementById('condo-endereco').value,
      cidade:   document.getElementById('condo-cidade').value,
    });
    toast('Condomínio criado!', 'ok');
    e.target.reset();
    carregarCondosAdmin();
    preencherSelectCondos();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-nova-unidade')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.unidades.criar({
      condominio_id: document.getElementById('unidade-condo-id').value,
      identificador: document.getElementById('unidade-ident').value,
      andar:         document.getElementById('unidade-andar').value,
      bloco:         document.getElementById('unidade-bloco').value,
    });
    toast('Unidade criada!', 'ok');
    e.target.reset();
    carregarUnidadesAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-novo-medidor')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.medidores.criar({
      unidade_id:   document.getElementById('medidor-unidade-id').value,
      tipo:         document.getElementById('medidor-tipo').value,
      numero_serie: document.getElementById('medidor-serie').value,
      localizacao:  document.getElementById('medidor-local').value,
    });
    toast('Medidor criado!', 'ok');
    e.target.reset();
    carregarMedidoresAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-novo-user')?.addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await API.users.criar({
      nome:  document.getElementById('user-nome').value,
      email: document.getElementById('user-email').value,
      senha: document.getElementById('user-senha').value,
      role:  document.getElementById('user-role').value,
    });
    toast('Usuário criado!', 'ok');
    e.target.reset();
    carregarUsersAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

// ── EXPOR GLOBAIS ─────────────────────────────────────
window.Router               = Router;
window.Auth                 = Auth;
window.switchTab            = switchTab;
window.mostrarFormConfirmar = mostrarFormConfirmar;
window.mostrarFormManual    = mostrarFormManual;
window.toggleCondo          = toggleCondo;
window.adicionarGestor      = adicionarGestor;
window.removerGestor        = removerGestor;
window.fecharModal             = fecharModal;
window.mostrarLeituraExistente = mostrarLeituraExistente;
window.iniciarEdicao           = iniciarEdicao;
window.switchCondoTab          = switchCondoTab;
window.adicionarLeitor         = adicionarLeitor;
window.removerLeitor           = removerLeitor;
window.carregarLeitoresCondo   = carregarLeitoresCondo;

document.getElementById('btn-logout')?.addEventListener('click', Auth.logout);
document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', () => Router.go(btn.dataset.page));
});

Router.go(Auth.isLogged() ? 'dashboard' : 'login');