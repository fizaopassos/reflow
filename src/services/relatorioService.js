const PDFDocument = require('pdfkit');

// ── HELPERS ───────────────────────────────────────────
function fmtData(d) {
  return new Date(d).toLocaleDateString('pt-BR');
}
function fmtValor(v, casas) {
  const c = casas !== undefined ? casas : 3;
  return parseFloat(v).toLocaleString('pt-BR', {
    minimumFractionDigits: c,
    maximumFractionDigits: c,
  });
}
function fmtVar(v, casas) {
  if (v === null || v === undefined) return '—';
  const c = casas !== undefined ? casas : 3;
  const num = parseFloat(v);
  return (num >= 0 ? '+' : '') + Math.abs(num).toLocaleString('pt-BR', {
    minimumFractionDigits: c,
    maximumFractionDigits: c,
  });
}
function fmtPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

// ── GERAR CSV — separador ponto-e-vírgula para compatibilidade pt-BR ──
function gerarCSVPeriodo(leituras) {
  const sep = ';';
  const header = ['Unidade','Bloco','Empresa','Data','Valor (m3)','Variacao (m3)','Alerta','Leitor','Metodo'];
  const rows = leituras.map(l => [
    l.unidade,
    l.bloco || '',
    l.empresa_snapshot || '',
    String(l.referencia_dia).padStart(2,'0') + '/' + String(l.referencia_mes).padStart(2,'0') + '/' + l.referencia_ano,
    fmtValor(l.valor, l.casas_decimais ?? 3),
    l.variacao !== null ? fmtValor(l.variacao, l.casas_decimais ?? 3) : '',
    l.alerta ? 'SIM' : '',
    l.leitor,
    l.metodo,
  ]);
  return [header, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(sep)).join('\n');
}

function gerarCSVMensal(linhas, mes, ano) {
  const sep = ';';
  const header = ['Unidade','Bloco','Empresa','Dias lidos','1a leitura (m3)','Ultima leitura (m3)','Consumo acumulado (m3)','Variacao %','Alerta'];
  const rows = linhas.map(l => [
    l.unidade,
    l.bloco || '',
    l.empresa || '',
    l.dias_lidos,
    fmtValor(l.primeira_leitura, l.casas_decimais ?? 3),
    fmtValor(l.ultima_leitura,   l.casas_decimais ?? 3),
    fmtValor(l.consumo_m3,       l.casas_decimais ?? 3),
    l.variacao_pct !== null ? fmtPct(l.variacao_pct) : 'N/D',
    l.alerta ? 'SIM' : '',
  ]);
  return [header, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g,'""') + '"').join(sep)).join('\n');
}

// ── GERAR PDF PERÍODO ─────────────────────────────────
function gerarPDFPeriodo(leituras, { condominio, dataInicio, dataFim }, res, acumulado, resumo, graficoBuffer = null) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="leituras-periodo.pdf"`);
  doc.pipe(res);

  _cabecalho(doc, 'Relatório de Leituras — Período', condominio, `${fmtData(dataInicio)} a ${fmtData(dataFim)}`);

  if (resumo) {
    doc.roundedRect(40, doc.y, 515, 50, 4).fillAndStroke('#f0f4ff', '#c4cde8');
    const ry = doc.y - 46;
    doc.fillColor('#254086').fontSize(9).font('Helvetica-Bold');
    doc.text('TOTAL DE LEITURAS', 55, ry + 8);
    doc.text('CONSUMO NO PERÍODO', 200, ry + 8);
    doc.text('ALERTAS', 395, ry + 8);
    doc.fillColor('#1a2036').fontSize(14).font('Helvetica-Bold');
    doc.text(String(resumo.total_leituras || 0), 55, ry + 22);
    doc.text(fmtValor(resumo.consumo_total_m3 || 0, 3), 200, ry + 22);
    doc.fillColor(resumo.total_alertas > 0 ? '#dc2626' : '#1a2036').fontSize(14);
    doc.text(String(resumo.total_alertas || 0), 395, ry + 22);
    doc.moveDown(2.5);
    doc.fillColor('#1a2036');
  }

  if (acumulado && acumulado.length) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#254086').text('Acumulado por unidade', 40);
    doc.moveDown(0.3);
    const colsAcum = [200, 200, 80, 35];
    _tabelaHeader(doc, colsAcum, ['Unidade', 'Empresa', 'Consumo no período', '⚠']);
    acumulado.forEach((a, i) => {
      const casas = a.casas_decimais ?? 3;
      _tabelaLinha(doc, colsAcum, [
        (a.bloco ? a.bloco + ' · ' : '') + a.unidade,
        a.empresa || '—',
        fmtValor(a.consumo, casas),
        a.alerta ? '⚠' : '',
      ], i % 2 === 0, a.alerta ? '#dc2626' : null);
    });
    doc.moveDown(1);
  }

  if (graficoBuffer) {
    try {
      if (doc.y > 420) doc.addPage();
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#254086').text('Gráfico de consumo por unidade');
      doc.moveDown(0.3);
      const imgWidth  = 515;
      const imgHeight = Math.round(imgWidth * 0.38);
      if (doc.y + imgHeight > 780) doc.addPage();
      doc.image(graficoBuffer, 40, doc.y, { width: imgWidth });
      doc.y += imgHeight + 12;
      doc.moveDown(0.5);
    } catch (e) {}
  }

  doc.fontSize(10).font('Helvetica-Bold').fillColor('#254086').text('Leituras detalhadas');
  doc.moveDown(0.3);
  const cols = [120, 75, 85, 70, 75, 45, 45];
  const headers = ['Unidade / Empresa', 'Data', 'Valor', 'Variação', 'Leitor', 'Mét.', 'Foto'];
  _tabelaHeader(doc, cols, headers);

  const fs   = require('fs');
  const path = require('path');

  leituras.forEach((l, i) => {
    const casas      = l.casas_decimais ?? 3;
    const unidadeStr = (l.bloco ? l.bloco + ' · ' : '') + l.unidade;
    const dataStr    = `${String(l.referencia_dia).padStart(2,'0')}/${String(l.referencia_mes).padStart(2,'0')}`;
    const varNum     = l.variacao !== null ? parseFloat(l.variacao) : null;
    const varStr     = varNum !== null ? fmtVar(varNum, casas) : '—';
    const alertaCor  = l.alerta ? '#dc2626' : null;
    const varCor     = l.alerta ? '#dc2626' : (varNum !== null && varNum > 0 ? '#0d9e6e' : null);

    _tabelaLinhaComFoto(doc, cols, [
      unidadeStr + '\n' + (l.empresa_snapshot || '—'),
      dataStr,
      fmtValor(l.valor, casas),
      varStr,
      l.leitor,
      l.metodo,
      l.foto_url,
    ], i % 2 === 0, alertaCor, varCor, 3);
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
function _tabelaLinhaComFoto(doc, cols, values, zebra, alertaCor, varCor, varIdx) {
  const path = require('path');
  const fs   = require('fs');
  const x0 = 40;
  const y  = doc.y;
  const h  = values[0].includes('\n') ? 26 : 16;
  const bg = zebra ? '#f0f4ff' : 'white';
  doc.rect(x0, y, cols.reduce((a,b)=>a+b,0), h).fill(bg);
  if (alertaCor) doc.rect(x0, y, 3, h).fill(alertaCor);

  let x = x0;
  values.forEach((v, i) => {
    if (i === cols.length - 1 && v && v.startsWith('/uploads/')) {
      try {
        const fpath = path.join(__dirname, '../../', v);
        if (fs.existsSync(fpath)) {
          doc.image(fpath, x + 3, y + 2, { width: cols[i] - 8, height: h - 4, fit: [cols[i]-8, h-4] });
        } else {
          doc.fillColor('#9aa3bf').fontSize(7).font('Helvetica').text('📷', x + 3, y + 4, { width: cols[i] - 6 });
        }
      } catch {
        doc.fillColor('#9aa3bf').fontSize(7).font('Helvetica').text('📷', x + 3, y + 4, { width: cols[i] - 6 });
      }
    } else {
      const isBold   = i === 0;
      const color    = i === varIdx && varCor ? varCor : '#1a2036';
      doc.fillColor(color).fontSize(7.5)
         .font(isBold ? 'Helvetica-Bold' : 'Helvetica')
         .text(String(v || '—'), x + 3, y + (h > 16 ? 3 : 4), { width: cols[i] - 6, lineGap: 1 });
    }
    x += cols[i];
  });
  doc.y = y + h + 2;
  if (doc.y > 760) doc.addPage();
}

function _cabecalho(doc, titulo, condominio, periodo) {
  doc.rect(0, 0, 595, 75).fill('#254086');
  doc.fillColor('white').fontSize(15).font('Helvetica-Bold').text('reflow', 40, 16);
  doc.fontSize(8).font('Helvetica').fillColor('rgba(255,255,255,0.7)').text('Sistema de leitura de medidores', 40, 34);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('white').text(titulo, 200, 14, { align: 'right', width: 355 });
  const infoStr = condominio + '  |  ' + periodo;
  doc.fontSize(8).font('Helvetica').fillColor('#c4cde8').text(infoStr, 200, 30, { align: 'right', width: 355, lineBreak: true });
  doc.moveDown(3.5);
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
  const sep = ';';
  const lines = [];
  extratos.forEach(e => {
    const titulo = (e.bloco ? e.bloco + ' · ' : '') + e.unidade + (e.empresa ? ' — ' + e.empresa : '');
    lines.push(['"' + titulo + '"']);
    lines.push(['"Data"','"Dia"','"Valor m3"','"Consumo dia m3"','"Leitor"','"Foto"'].join(sep));
    e.linhas.forEach(l => {
      if (l.sem_leitura) {
        lines.push(['"' + l.data + '"', '"' + l.dia_semana + '"', '"Sem leitura"', '""', '""', '""'].join(sep));
      } else {
        lines.push([
          '"' + l.data + '"',
          '"' + l.dia_semana + '"',
          '"' + fmtValor(l.valor) + '"',
          '"' + (l.consumo !== null ? fmtValor(l.consumo) : '—') + '"',
          '"' + (l.leitor || '') + '"',
          '"' + (l.tem_foto ? 'Sim' : 'Não') + '"',
        ].join(sep));
      }
    });
    lines.push(['"CONSUMO TOTAL"', '""', '""', '"' + fmtValor(e.consumo_total) + '"', '""', '""'].join(sep));
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
    _cabecalho(doc, 'Extrato de Leitura', condominio, nomeMes + ' de ' + ano);

    const unidadeStr = (e.bloco ? e.bloco + ' · ' : '') + e.unidade;
    doc.roundedRect(40, doc.y, 515, 44, 4).fillAndStroke('#f0f4ff', '#c4cde8');
    const uy = doc.y - 40;
    doc.fillColor('#254086').fontSize(13).font('Helvetica-Bold').text(unidadeStr, 52, uy + 6);
    doc.fillColor('#4a5578').fontSize(9).font('Helvetica')
       .text((e.empresa || 'Sem empresa ocupante') + '  |  Série: ' + (e.numero_serie || '—') + '  |  ' + {AGUA:'Água',ENERGIA:'Energia',GAS:'Gás'}[e.tipo], 52, uy + 24);
    doc.moveDown(2);

    const cols = [75, 35, 75, 75, 90, 30, 135];
    const headers = ['Data', 'Dia', 'Valor m³', 'Consumo', 'Leitor', '📷', 'Observações'];
    _tabelaHeader(doc, cols, headers);

    e.linhas.forEach((l, i) => {
      if (l.sem_leitura) {
        _tabelaLinhaExtrato(doc, cols, [l.dia_semana + ' ' + l.data, 'Sem leitura', '—', '—', '—', ''], i % 2 === 0, '#f8f8f8', true);
      } else {
        const consumoStr = l.consumo !== null ? (l.consumo >= 0 ? '+' : '') + fmtValor(l.consumo) : '—';
        _tabelaLinhaExtrato(doc, cols, [
          l.dia_semana + ' ' + l.data,
          fmtValor(l.valor),
          consumoStr,
          l.leitor || '—',
          l.tem_foto ? '✓' : '',
          '',
        ], i % 2 === 0, null, false);
      }
    });

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