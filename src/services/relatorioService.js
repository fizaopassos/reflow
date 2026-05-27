const PDFDocument = require('pdfkit');

// ── HELPERS ───────────────────────────────────────────
function fmtData(d) {
  return new Date(d).toLocaleDateString('pt-BR');
}
function fmtValor(v) {
  return parseFloat(v).toFixed(3).replace('.', ',');
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

// ── GERAR CSV ─────────────────────────────────────────
function gerarCSVPeriodo(leituras) {
  const header = ['Unidade','Bloco','Empresa','Data','Valor (m³)','Variação (m³)','Leitor','Método'];
  const rows = leituras.map(l => [
    l.unidade,
    l.bloco || '',
    l.empresa_snapshot || '',
    `${String(l.referencia_dia).padStart(2,'0')}/${String(l.referencia_mes).padStart(2,'0')}/${l.referencia_ano}`,
    fmtValor(l.valor),
    l.variacao !== null ? fmtValor(l.variacao) : '',
    l.leitor,
    l.metodo,
  ]);
  return [header, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
}

function gerarCSVMensal(linhas, mes, ano) {
  const header = ['Unidade','Bloco','Empresa','Dias lidos','1ª leitura (m³)','Última leitura (m³)','Consumo acumulado (m³)','Variação %'];
  const rows = linhas.map(l => [
    l.unidade,
    l.bloco || '',
    l.empresa || '',
    l.dias_lidos,
    fmtValor(l.primeira_leitura),
    fmtValor(l.ultima_leitura),
    fmtValor(l.consumo_m3),
    l.variacao_pct !== null ? fmtPct(l.variacao_pct) : 'N/D',
  ]);
  return [header, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\n');
}

// ── GERAR PDF ─────────────────────────────────────────
function gerarPDFPeriodo(leituras, { condominio, dataInicio, dataFim }, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="leituras-periodo.pdf"`);
  doc.pipe(res);

  // Header
  _cabecalho(doc, 'Relatório de Leituras — Período', condominio, `${fmtData(dataInicio)} a ${fmtData(dataFim)}`);

  // Tabela
  const cols = [140, 80, 100, 70, 70, 80];
  const headers = ['Unidade / Empresa', 'Data', 'Valor m³', 'Variação', 'Leitor', 'Método'];
  _tabelaHeader(doc, cols, headers);

  leituras.forEach((l, i) => {
    const unidadeStr = (l.bloco ? l.bloco + ' · ' : '') + l.unidade;
    const empresaStr = l.empresa_snapshot || '—';
    const dataStr = `${String(l.referencia_dia).padStart(2,'0')}/${String(l.referencia_mes).padStart(2,'0')}`;
    const varStr = l.variacao !== null ? fmtValor(l.variacao) : '—';
    const alertaCor = l.alerta ? '#dc2626' : null;

    _tabelaLinha(doc, cols, [
      unidadeStr + '\n' + empresaStr,
      dataStr,
      fmtValor(l.valor),
      varStr,
      l.leitor,
      l.metodo,
    ], i % 2 === 0, alertaCor);
  });

  _rodape(doc);
  doc.end();
}

function gerarPDFMensal(linhas, resumo, { condominio, mes, ano }, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const nomeMes = new Date(ano, mes - 1).toLocaleString('pt-BR', { month: 'long' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="acumulado-${mes}-${ano}.pdf"`);
  doc.pipe(res);

  _cabecalho(doc, 'Relatório Acumulado Mensal', condominio, `${nomeMes} de ${ano}`);

  // Resumo box
  doc.roundedRect(40, doc.y, 515, 50, 4).fillAndStroke('#f0f4ff', '#c4cde8');
  const ry = doc.y - 46;
  doc.fillColor('#254086').fontSize(9).font('Helvetica-Bold');
  doc.text('TOTAL CONSUMIDO', 55, ry + 8);
  doc.text('MEDIDORES LIDOS', 200, ry + 8);
  doc.text('MÉDIA POR UNIDADE', 345, ry + 8);
  doc.fillColor('#1a2036').fontSize(14).font('Helvetica-Bold');
  doc.text(fmtValor(resumo.consumo_total_m3) + ' m³', 55, ry + 22);
  doc.text(String(resumo.total_medidores_lidos), 200, ry + 22);
  doc.text(fmtValor(resumo.media_consumo_m3) + ' m³', 345, ry + 22);
  doc.moveDown(2.5);

  // Tabela
  const cols = [140, 70, 90, 70, 70, 75];
  const headers = ['Unidade / Empresa', 'Dias', '1ª Leitura', 'Última', 'Consumo', 'Variação'];
  _tabelaHeader(doc, cols, headers);

  linhas.forEach((l, i) => {
    const unidadeStr = (l.bloco ? l.bloco + ' · ' : '') + l.unidade;
    const empresaStr = l.empresa || '—';
    const varStr = l.variacao_pct !== null ? fmtPct(l.variacao_pct) : 'N/D';
    const alertaCor = l.alerta ? '#dc2626' : null;

    _tabelaLinha(doc, cols, [
      unidadeStr + '\n' + empresaStr,
      String(l.dias_lidos),
      fmtValor(l.primeira_leitura),
      fmtValor(l.ultima_leitura),
      fmtValor(l.consumo_m3),
      varStr,
    ], i % 2 === 0, alertaCor);
  });

  // Alertas
  const alertas = linhas.filter(l => l.alerta);
  if (alertas.length) {
    doc.moveDown();
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#dc2626').text('⚠ Alertas de variação anômala:');
    doc.font('Helvetica').fontSize(9).fillColor('#1a2036');
    alertas.forEach(l => {
      doc.text(`• ${(l.bloco ? l.bloco + ' · ' : '') + l.unidade}: variação de ${fmtPct(l.variacao_pct)} (${l.empresa || '—'})`);
    });
  }

  _rodape(doc);
  doc.end();
}

// ── HELPERS PDF ───────────────────────────────────────
function _cabecalho(doc, titulo, condominio, periodo) {
  doc.rect(0, 0, 595, 70).fill('#254086');
  doc.fillColor('white').fontSize(16).font('Helvetica-Bold').text('reflow', 40, 18);
  doc.fontSize(9).font('Helvetica').text('Sistema de leitura de medidores', 40, 38);
  doc.fontSize(13).font('Helvetica-Bold').text(titulo, 200, 18, { align: 'right', width: 355 });
  doc.fontSize(9).font('Helvetica').fillColor('#c4cde8').text(condominio + '  |  ' + periodo, 200, 38, { align: 'right', width: 355 });
  doc.moveDown(3);
  doc.fillColor('#1a2036');
}

function _tabelaHeader(doc, cols, headers) {
  const x0 = 40;
  const y  = doc.y;
  doc.rect(x0, y, cols.reduce((a,b) => a+b, 0), 18).fill('#254086');
  let x = x0;
  headers.forEach((h, i) => {
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold').text(h, x + 4, y + 5, { width: cols[i] - 8 });
    x += cols[i];
  });
  doc.moveDown(1.2);
}

function _tabelaLinha(doc, cols, values, zebra, alertaCor) {
  const x0 = 40;
  const y  = doc.y;
  const h  = values[0].includes('\n') ? 26 : 16;

  if (zebra) doc.rect(x0, y, cols.reduce((a,b)=>a+b,0), h).fill('#f0f4ff');
  if (alertaCor) doc.rect(x0, y, 3, h).fill(alertaCor);

  let x = x0;
  values.forEach((v, i) => {
    const color = i === 0 && alertaCor ? alertaCor : '#1a2036';
    doc.fillColor(color).fontSize(7.5).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica')
       .text(v, x + 4, y + 3, { width: cols[i] - 8, lineGap: 1 });
    x += cols[i];
  });
  doc.y = y + h + 2;

  // Nova página se necessário
  if (doc.y > 760) doc.addPage();
}

function _rodape(doc) {
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    doc.fontSize(7).fillColor('#9aa3bf').font('Helvetica')
       .text('Gerado em ' + new Date().toLocaleString('pt-BR') + '  —  reflow · Retha', 40, 820, { align: 'center', width: 515 });
  }
}

// ── CSV EXTRATO ───────────────────────────────────────
function gerarCSVExtrato(extratos, mes, ano) {
  const lines = [];
  extratos.forEach(e => {
    const titulo = (e.bloco ? e.bloco + ' · ' : '') + e.unidade + (e.empresa ? ' — ' + e.empresa : '');
    lines.push(['"' + titulo + '"']);
    lines.push(['"Data"','"Dia"','"Valor m³"','"Consumo dia m³"','"Leitor"','"Foto"'].join(','));
    e.linhas.forEach(l => {
      if (l.sem_leitura) {
        lines.push(['"' + l.data + '"', '"' + l.dia_semana + '"', '"Sem leitura"', '""', '""', '""'].join(','));
      } else {
        lines.push([
          '"' + l.data + '"',
          '"' + l.dia_semana + '"',
          '"' + fmtValor(l.valor) + '"',
          '"' + (l.consumo !== null ? fmtValor(l.consumo) : '—') + '"',
          '"' + (l.leitor || '') + '"',
          '"' + (l.tem_foto ? 'Sim' : 'Não') + '"',
        ].join(','));
      }
    });
    lines.push(['"CONSUMO TOTAL"', '""', '""', '"' + fmtValor(e.consumo_total) + '"', '""', '""'].join(','));
    lines.push(['']);
  });
  return lines.join('\n');
}

// ── PDF EXTRATO ───────────────────────────────────────
function gerarPDFExtrato(extratos, { condominio, mes, ano }, res) {
  const PDFDocument = require('pdfkit');
  const fs = require('fs');
  const path = require('path');
  const doc = new PDFDocument({ margin: 40, size: 'A4', autoFirstPage: false });
  const nomeMes = new Date(ano, mes - 1).toLocaleString('pt-BR', { month: 'long' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="extrato-${mes}-${ano}.pdf"`);
  doc.pipe(res);

  extratos.forEach((e, idx) => {
    doc.addPage();

    // Cabeçalho da página
    _cabecalho(doc, 'Extrato de Leitura', condominio, nomeMes + ' de ' + ano);

    // Identificação da unidade
    const unidadeStr = (e.bloco ? e.bloco + ' · ' : '') + e.unidade;
    doc.roundedRect(40, doc.y, 515, 44, 4).fillAndStroke('#f0f4ff', '#c4cde8');
    const uy = doc.y - 40;
    doc.fillColor('#254086').fontSize(13).font('Helvetica-Bold').text(unidadeStr, 52, uy + 6);
    doc.fillColor('#4a5578').fontSize(9).font('Helvetica')
       .text((e.empresa || 'Sem empresa ocupante') + '  |  Série: ' + (e.numero_serie || '—') + '  |  ' + {AGUA:'Água',ENERGIA:'Energia',GAS:'Gás'}[e.tipo], 52, uy + 24);
    doc.moveDown(2);

    // Tabela de dias
    const cols = [75, 35, 75, 75, 90, 30, 135];
    const headers = ['Data', 'Dia', 'Valor m³', 'Consumo', 'Leitor', '📷', 'Observações'];
    _tabelaHeader(doc, cols, headers);

    e.linhas.forEach((l, i) => {
      if (l.sem_leitura) {
        _tabelaLinhaExtrato(doc, cols, [l.data, l.dia_semana, 'Sem leitura', '—', '—', '—', ''], i % 2 === 0, '#f8f8f8', true);
      } else {
        const consumoStr = l.consumo !== null ? (l.consumo >= 0 ? '+' : '') + fmtValor(l.consumo) : '—';
        _tabelaLinhaExtrato(doc, cols, [
          l.data, l.dia_semana,
          fmtValor(l.valor),
          consumoStr,
          l.leitor || '—',
          l.tem_foto ? '✓' : '',
          '',
        ], i % 2 === 0, null, false);
      }
    });

    // Rodapé da unidade — total
    const y = doc.y;
    doc.rect(40, y, 515, 20).fill('#254086');
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
       .text('CONSUMO TOTAL DO MÊS', 44, y + 6)
       .text(fmtValor(e.consumo_total) + ' m³', 44, y + 6, { align: 'right', width: 507 });
    doc.moveDown(1.5);
    doc.fillColor('#4a5578').fontSize(8).font('Helvetica')
       .text('Dias com leitura: ' + e.dias_lidos + ' de ' + e.linhas.length, 40);
  });

  _rodape(doc);
  doc.end();
}

function _tabelaLinhaExtrato(doc, cols, values, zebra, bgOverride, muted) {
  const x0 = 40;
  const y  = doc.y;
  const h  = 16;
  const bg = bgOverride || (zebra ? '#f0f4ff' : 'white');
  doc.rect(x0, y, cols.reduce((a,b)=>a+b,0), h).fill(bg);
  let x = x0;
  values.forEach((v, i) => {
    const color = muted ? '#aaa' : (i === 3 && parseFloat(v) > 0 ? '#0d9e6e' : '#1a2036');
    doc.fillColor(color).fontSize(7.5)
       .font(i === 2 || i === 3 ? 'Helvetica-Bold' : 'Helvetica')
       .text(String(v), x + 3, y + 4, { width: cols[i] - 6 });
    x += cols[i];
  });
  doc.y = y + h + 1;
  if (doc.y > 760) doc.addPage();
}

module.exports = { gerarCSVPeriodo, gerarCSVMensal, gerarPDFPeriodo, gerarPDFMensal, gerarCSVExtrato, gerarPDFExtrato };
