'use strict';

// ── SERVICE WORKER ────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ── AUTH ──────────────────────────────────────────────────────
const Auth = {
  get token()   { return localStorage.getItem('token'); },
  get user()    { try { return JSON.parse(atob(Auth.token.split('.')[1])); } catch { return null; } },
  isLogged()    { return !!Auth.token && !!Auth.user; },
  logout()      { localStorage.removeItem('token'); Router.go('login'); },
  is(role)      { return Auth.user?.role === role; },
  canAdmin()    { return Auth.is('ADMIN'); },
  canManage()   { return Auth.is('ADMIN') || Auth.is('GESTOR'); },
};

// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${tipo}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── ROUTER ────────────────────────────────────────────────────
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

// ── NAVBAR ────────────────────────────────────────────────────
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

// ── VIEWS ─────────────────────────────────────────────────────
const Views = {};

// LOGIN
Views.login = () => {};

document.getElementById('form-login')?.addEventListener('submit', async e => {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const senha = document.getElementById('login-senha').value;
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const res = await API.login(email, senha);
    localStorage.setItem('token', res.token);
    Router.go('dashboard');
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

// DASHBOARD
Views.dashboard = async () => {
  const el = document.getElementById('dashboard-cards');
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';
  try {
    const data = await API.dashboard();
    const mes = new Date(data.ano, data.mes - 1).toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    document.getElementById('dashboard-mes').textContent = mes;

    if (!data.condominios.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum condomínio disponível.</p>';
      return;
    }

    el.innerHTML = data.condominios.map(c => `
      <div class="card card-condo" onclick="Router.go('medicoes', {condominio_id: '${c.id}', nome: '${c.nome}'})">
        <div class="card-header">
          <span class="card-title">${c.nome}</span>
          <span class="badge ${c.percentual === 100 ? 'badge-ok' : c.percentual > 50 ? 'badge-warn' : 'badge-pend'}">${c.percentual}%</span>
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

// MEDIÇÕES (grid de unidades do condomínio)
Views.medicoes = async ({ condominio_id, nome }) => {
  document.getElementById('medicoes-titulo').textContent = nome || 'Medições';
  const el = document.getElementById('medicoes-grid');
  el.innerHTML = '<p class="loading-msg">Carregando...</p>';

  const agora = new Date();
  const mes = agora.getMonth() + 1;
  const ano = agora.getFullYear();

  try {
    const [medidores, leituras] = await Promise.all([
      API.medidores.listar().then(all => all.filter(m => {
        // filtra pelo condomínio
        return m.unidade?.condominio?.id === condominio_id;
      })),
      API.leituras.listar({ condominio_id, mes, ano }),
    ]);

    // Busca medidores do condomínio
    const medidoresCondo = await API.get(`/medidores?condominio_id=${condominio_id}`).catch(() => []);
    const leiturasMap = {};
    leituras.forEach(l => { leiturasMap[l.medidor_id] = l; });

    if (!medidoresCondo.length) {
      el.innerHTML = '<p class="empty-msg">Nenhum medidor cadastrado.</p>';
      return;
    }

    el.innerHTML = medidoresCondo.map(m => {
      const leitura = leiturasMap[m.id];
      const feita = !!leitura;
      return `
        <div class="card card-medidor ${feita ? 'feito' : 'pendente'}"
             onclick="Router.go('leitura', {medidor_id: '${m.id}', unidade: '${m.unidade?.identificador}', feita: ${feita}})">
          <div class="card-header">
            <span class="card-title">${m.unidade?.identificador || '—'}</span>
            <span class="badge ${feita ? 'badge-ok' : 'badge-pend'}">${feita ? 'Lido' : 'Pendente'}</span>
          </div>
          <div class="card-meta">
            <span>Série: ${m.numero_serie || '—'}</span>
            ${leitura ? `<span>Leitura: <strong>${leitura.valor} m³</strong></span>
            <span>${new Date(leitura.criado_em).toLocaleString('pt-BR')}</span>` : ''}
          </div>
        </div>`;
    }).join('');

  } catch (err) {
    el.innerHTML = `<p class="error-msg">${err.message}</p>`;
  }
};

// LEITURA (câmera + IA)
Views.leitura = async ({ medidor_id, unidade }) => {
  document.getElementById('leitura-unidade').textContent = unidade || 'Medidor';
  document.getElementById('leitura-medidor-id').value = medidor_id || '';

  const agora = new Date();
  document.getElementById('leitura-mes').value = agora.getMonth() + 1;
  document.getElementById('leitura-ano').value = agora.getFullYear();

  // Reset estado
  document.getElementById('leitura-preview').style.display = 'none';
  document.getElementById('leitura-idle').style.display = 'flex';
  document.getElementById('leitura-resultado').style.display = 'none';
  document.getElementById('leitura-form-manual').style.display = 'none';
  document.getElementById('btn-analisar').style.display = 'none';
  document.getElementById('leitura-file').value = '';
};

document.getElementById('leitura-file')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('leitura-preview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  document.getElementById('leitura-idle').style.display = 'none';
  document.getElementById('btn-analisar').style.display = 'flex';
  document.getElementById('leitura-resultado').style.display = 'none';
});

document.getElementById('btn-analisar')?.addEventListener('click', async () => {
  const file = document.getElementById('leitura-file').files[0];
  if (!file) return;

  const btn = document.getElementById('btn-analisar');
  btn.disabled = true;
  btn.textContent = 'Analisando...';
  document.getElementById('leitura-resultado').style.display = 'none';

  try {
    const form = new FormData();
    form.append('imagem', file);
    const res = await API.leituras.analisar(form);

    if (res.valor_completo === 'ERRO') {
      toast('IA não conseguiu ler. Use entrada manual.', 'warn');
      document.getElementById('leitura-form-manual').style.display = 'block';
    } else {
      document.getElementById('leitura-valor-display').textContent = `${res.valor_completo} m³`;
      document.getElementById('leitura-conf').textContent = `Confiança: ${res.confianca}`;
      document.getElementById('leitura-obs').textContent = res.observacoes || '';
      document.getElementById('leitura-valor-input').value = res.valor_completo;
      document.getElementById('leitura-resultado').style.display = 'block';
    }
  } catch (err) {
    toast('Erro na análise. Use entrada manual.', 'erro');
    document.getElementById('leitura-form-manual').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Analisar com IA';
  }
});

document.getElementById('btn-usar-manual')?.addEventListener('click', () => {
  document.getElementById('leitura-form-manual').style.display = 'block';
  document.getElementById('leitura-resultado').style.display = 'none';
});

document.getElementById('form-leitura')?.addEventListener('submit', async e => {
  e.preventDefault();
  const valor     = document.getElementById('leitura-valor-input').value;
  const medidor_id = document.getElementById('leitura-medidor-id').value;
  const mes       = document.getElementById('leitura-mes').value;
  const ano       = document.getElementById('leitura-ano').value;
  const file      = document.getElementById('leitura-file').files[0];

  const form = new FormData();
  form.append('medidor_id', medidor_id);
  form.append('valor', valor);
  form.append('referencia_mes', mes);
  form.append('referencia_ano', ano);
  form.append('metodo', file ? 'GEMINI' : 'MANUAL');
  if (file) form.append('imagem', file);

  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await API.leituras.registrar(form);
    toast('✓ Leitura salva!', 'ok');
    history.back();
  } catch (err) {
    toast(err.message, 'erro');
  } finally {
    btn.disabled = false;
  }
});

// ADMIN
Views.admin = async () => {
  if (!Auth.canAdmin()) { Router.go('dashboard'); return; }
  await Promise.all([carregarCondosAdmin(), carregarUsersAdmin()]);
};

async function carregarCondosAdmin() {
  const el = document.getElementById('admin-condos-list');
  try {
    const condos = await API.condominios.listar();
    el.innerHTML = condos.map(c => `
      <div class="list-item">
        <span>${c.nome}</span>
        <span class="text-muted">${c._count?.unidades || 0} unidades</span>
      </div>`).join('') || '<p class="empty-msg">Nenhum condomínio.</p>';
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

async function carregarUsersAdmin() {
  const el = document.getElementById('admin-users-list');
  try {
    const users = await API.users.listar();
    el.innerHTML = users.map(u => `
      <div class="list-item">
        <div>
          <span>${u.nome}</span>
          <span class="text-muted"> — ${u.email}</span>
        </div>
        <span class="badge badge-role-${u.role.toLowerCase()}">${u.role}</span>
      </div>`).join('') || '<p class="empty-msg">Nenhum usuário.</p>';
  } catch { el.innerHTML = '<p class="error-msg">Erro ao carregar.</p>'; }
}

document.getElementById('form-novo-condo')?.addEventListener('submit', async e => {
  e.preventDefault();
  const nome = document.getElementById('condo-nome').value;
  const endereco = document.getElementById('condo-endereco').value;
  try {
    await API.condominios.criar({ nome, endereco });
    toast('Condomínio criado!', 'ok');
    e.target.reset();
    carregarCondosAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

document.getElementById('form-novo-user')?.addEventListener('submit', async e => {
  e.preventDefault();
  const data = {
    nome:  document.getElementById('user-nome').value,
    email: document.getElementById('user-email').value,
    senha: document.getElementById('user-senha').value,
    role:  document.getElementById('user-role').value,
  };
  try {
    await API.users.criar(data);
    toast('Usuário criado!', 'ok');
    e.target.reset();
    carregarUsersAdmin();
  } catch (err) { toast(err.message, 'erro'); }
});

// ── INIT ──────────────────────────────────────────────────────
window.Router = Router;
window.Auth   = Auth;

document.getElementById('btn-logout')?.addEventListener('click', Auth.logout);

// Navegação pela navbar
document.querySelectorAll('[data-page]').forEach(btn => {
  btn.addEventListener('click', () => Router.go(btn.dataset.page));
});

// Inicia
Router.go(Auth.isLogged() ? 'dashboard' : 'login');
