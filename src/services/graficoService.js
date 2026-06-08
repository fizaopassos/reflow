'use strict';

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

const CORES = [
  '#6366f1','#22c55e','#f59e0b','#ef4444','#3b82f6',
  '#ec4899','#14b8a6','#a855f7','#f97316','#84cc16',
];

/**
 * Gera um gráfico de barras horizontais como Buffer PNG.
 * @param {Array<{label: string, consumo: number}>} dados
 * @param {string} unidadeMedida  ex: 'm³' ou 'kWh'
 * @param {string} titulo         ex: 'Consumo por período'
 * @returns {Promise<Buffer>}
 */
async function gerarGraficoBarras(dados, unidadeMedida = 'm³', titulo = 'Consumo por período') {
  // Altura dinâmica: 40px por barra, mínimo 200px
  const altura = Math.max(200, dados.length * 44 + 80);
  const largura = 900;

  const renderer = new ChartJSNodeCanvas({
    width: largura,
    height: altura,
    backgroundColour: 'white',
  });

  const config = {
    type: 'bar',
    data: {
      labels: dados.map(d => d.label),
      datasets: [{
        label: 'Consumo ' + unidadeMedida,
        data: dados.map(d => d.consumo),
        backgroundColor: dados.map((_, i) => CORES[i % CORES.length] + 'cc'),
        borderColor:     dados.map((_, i) => CORES[i % CORES.length]),
        borderWidth: 1.5,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: false },
        title: {
          display: !!titulo,
          text: titulo,
          font: { size: 14, weight: 'bold', family: 'sans-serif' },
          color: '#254086',
          padding: { bottom: 16 },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,.06)' },
          title: {
            display: true,
            text: unidadeMedida,
            font: { size: 11 },
            color: '#9aa3bf',
          },
        },
        y: {
          ticks: {
            font: { size: 11 },
            maxRotation: 0,
          },
          grid: { display: false },
        },
      },
      layout: { padding: { left: 10, right: 20, top: 10, bottom: 10 } },
    },
  };

  return renderer.renderToBuffer(config);
}

module.exports = { gerarGraficoBarras };
