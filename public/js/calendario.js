'use strict';

// ── CALENDÁRIO DE LEITURAS ────────────────────────────────────
// Exibido no Dashboard para ADMIN e GESTOR.
// Mostra status de cobertura de leituras por dia do mês,
// com filtro por condomínio e navegação entre meses.
// Ao clicar num dia pendente/parcial, navega para a tela de
// medições com o condomínio e a data retroativa pré-preenchidos.

const Calendario = (() => {

  const MESES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro',
  ];
  const DOW = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let _mes  = new Date().getMonth();
  let _ano  = new Date().getFullYear();
  let _condoId   = '';
  let _condoNome = '';

  // ── helper de fetch autenticado ──────────────────────────
  async function _get(path) {
    const res = await fetch('/api' + path, {
      headers: { Authorization: 'Bearer ' + Auth.token },
    });
    if (!res.ok) throw new Error('Erro ' + res.status);
    return res.json();
  }

  // ── inicializa o painel (chamado em Views.dashboard) ─────
  async function init() {
    const painel = document.getElementById('cal-painel');
    if (!painel) return;

    if (!Auth.canManage()) {
      painel.style.display = 'none';
      return;
    }
    painel.style.display = '';

    try {
      const condos = await _get('/condominios');
      if (!condos.length) return;

      const sel = document.getElementById('cal-condo-sel');
      if (sel) {
        sel.innerHTML = condos.map(c =>
          `<option value="${c.id}">${c.nome}</option>`
        ).join('');
        _condoId   = condos[0].id;
        _condoNome = condos[0].nome;
      }

      await _renderMes();
    } catch (e) {
      console.error('[Calendario] init:', e);
      const grid = document.getElementById('cal-grid');
      if (grid) grid.innerHTML = '<p class="error-msg" style="grid-column:1/-1">Erro ao carregar calendário.</p>';
    }
  }

  // ── renderiza o grid do mês atual ───────────────────────
  async function _renderMes() {
    const grid  = document.getElementById('cal-grid');
    const label = document.getElementById('cal-mes-label');
    if (!grid || !label) return;

    label.textContent = MESES[_mes] + ' ' + _ano;
    grid.innerHTML = '<p class="loading-msg" style="grid-column:1/-1;padding:16px 0">Carregando...</p>';

    if (!_condoId) {
      grid.innerHTML = '<p class="empty-msg" style="grid-column:1/-1">Selecione um condomínio.</p>';
      return;
    }

    try {
      const [medidores, leituras] = await Promise.all([
        _get('/medidores?condominio_id=' + _condoId),
        _get('/leituras?condominio_id=' + _condoId + '&mes=' + (_mes + 1) + '&ano=' + _ano),
      ]);

      const totalMedidores = medidores.length;

      // Agrupa leituras por dia → Set de medidor_ids únicos
      const porDia = {};
      leituras.forEach(l => {
        const d = l.referencia_dia;
        if (!porDia[d]) porDia[d] = new Set();
        porDia[d].add(l.medidor_id);
      });

      const hoje        = new Date();
      const primeiroDia = new Date(_ano, _mes, 1).getDay();
      const diasNoMes   = new Date(_ano, _mes + 1, 0).getDate();

      const ehHoje = d =>
        d === hoje.getDate() && _mes === hoje.getMonth() && _ano === hoje.getFullYear();

      const ehFuturo = d => {
        const dataCell = new Date(_ano, _mes, d);
        dataCell.setHours(0,0,0,0);
        const hojeZero = new Date();
        hojeZero.setHours(0,0,0,0);
        return dataCell > hojeZero;
      };

      // ── cabeçalho dias da semana ──
      let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

      // ── células vazias antes do dia 1 ──
      for (let i = 0; i < primeiroDia; i++) {
        html += '<div class="cal-day cal-empty"></div>';
      }

      // ── células dos dias ──
      for (let d = 1; d <= diasNoMes; d++) {
        const futuro = ehFuturo(d);
        const lidos  = porDia[d] ? porDia[d].size : 0;
        const total  = totalMedidores;
        const pend   = total - lidos;

        let classeStatus = '';
        let badgeHtml    = '';
        let clickable    = false;

        if (futuro || total === 0) {
          classeStatus = 'cal-futuro';
        } else if (lidos === 0) {
          classeStatus = 'cal-pendente';
          badgeHtml    = `<span class="cal-badge">${pend} pend.</span>`;
          clickable    = true;
        } else if (lidos >= total) {
          classeStatus = 'cal-completo';
          badgeHtml    = `<span class="cal-badge">${lidos}/${total}</span>`;
        } else {
          classeStatus = 'cal-parcial';
          badgeHtml    = `<span class="cal-badge">${lidos}/${total}</span>`;
          clickable    = true;
        }

        const numHtml = ehHoje(d)
          ? `<span class="cal-num"><span class="cal-num-hoje">${d}</span></span>`
          : `<span class="cal-num">${d}</span>`;

        const attrs = clickable
          ? `role="button" tabindex="0"
             onclick="Calendario.abrirDia(${d},${_mes + 1},${_ano})"
             onkeydown="if(event.key==='Enter'||event.key===' ')Calendario.abrirDia(${d},${_mes + 1},${_ano})"
             aria-label="Dia ${d} — ${pend || 0} pendentes, clique para registrar"`
          : `aria-label="Dia ${d} — ${lidos} de ${total} lidos"`;

        html += `<div class="cal-day ${classeStatus}" ${attrs}>${numHtml}${badgeHtml}</div>`;
      }

      grid.innerHTML = html;

    } catch (e) {
      console.error('[Calendario] _renderMes:', e);
      grid.innerHTML = '<p class="error-msg" style="grid-column:1/-1">Erro ao carregar dados.</p>';
    }
  }

  // ── navegação entre meses ────────────────────────────────
  function mesAnterior() {
    _mes--;
    if (_mes < 0) { _mes = 11; _ano--; }
    _renderMes();
  }

  function proximoMes() {
    _mes++;
    if (_mes > 11) { _mes = 0; _ano++; }
    _renderMes();
  }

  // ── troca de condomínio ──────────────────────────────────
  function trocarCondo() {
    const sel = document.getElementById('cal-condo-sel');
    if (!sel) return;
    _condoId   = sel.value;
    _condoNome = sel.options[sel.selectedIndex]?.text || '';
    _renderMes();
  }

  // ── clique num dia pendente ou parcial ───────────────────
  // Armazena a data retroativa e navega para a tela de medições.
  // Views.leitura() lê window._dataRetroativa para pré-preencher
  // os campos de dia/mês/ano automaticamente.
  function abrirDia(dia, mes, ano) {
    if (!_condoId) return;
    window._dataRetroativa = { dia, mes, ano };
    Router.go('medicoes', {
      condominio_id: _condoId,
      nome: _condoNome,
      data_retroativa: { dia, mes, ano },
    });
  }

  return { init, mesAnterior, proximoMes, trocarCondo, abrirDia };

})();

window.Calendario = Calendario;
