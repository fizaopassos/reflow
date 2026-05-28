'use strict';

/**
 * Formata um valor numérico conforme as casas decimais do medidor.
 */
function formatarValor(valor, casasDecimais) {
  const c = casasDecimais !== undefined ? parseInt(casasDecimais) : 3;
  const num = parseFloat(valor);
  if (isNaN(num)) return '—';
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: c,
    maximumFractionDigits: c,
  });
}

/**
 * Interpreta o input do leitor e retorna o valor numérico correto.
 *
 * Com separador (vírgula ou ponto): usa como está
 *   "4.952,634" → 4952.634  |  "4952,634" → 4952.634
 *
 * Sem separador: os últimos `casas` dígitos são decimais
 *   "121480" casas=2 → int="1214", dec="80" → 1214.80
 *   "4952634" casas=3 → int="4952", dec="634" → 4952.634
 *
 * NOTA: o leitor deve digitar todos os dígitos incluindo zeros finais.
 *   "121480" e não "12148" para casas=2.
 *   O hint na tela orienta isso.
 */
function interpretarInput(input, casasDecimais) {
  const casas = casasDecimais !== undefined ? parseInt(casasDecimais) : 3;
  let str = String(input).trim().replace(/\s/g, '');
  if (!str) return NaN;

  const temVirgula = str.includes(',');
  const temPonto   = str.includes('.');

  if (temVirgula || temPonto) {
    if (temVirgula) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      const partes = str.split('.');
      if (partes.length === 2 && partes[1].length <= 3) {
        // ponto decimal ok
      } else {
        str = str.replace(/\./g, '');
        return interpretarSemSeparador(str, casas);
      }
    }
    return parseFloat(str);
  }

  return interpretarSemSeparador(str, casas);
}

function interpretarSemSeparador(str, casas) {
  if (casas === 0) return parseInt(str);
  if (str.length <= casas) str = str.padStart(casas + 1, '0');
  const intPart = str.slice(0, -casas) || '0';
  const decPart = str.slice(-casas);
  return parseFloat(intPart + '.' + decPart);
}

function formatarVariacao(variacao, casasDecimais) {
  if (variacao === null || variacao === undefined) return '—';
  const c = casasDecimais !== undefined ? parseInt(casasDecimais) : 3;
  const num = parseFloat(variacao);
  if (isNaN(num)) return '—';
  const str = Math.abs(num).toLocaleString('pt-BR', {
    minimumFractionDigits: c,
    maximumFractionDigits: c,
  });
  return (num >= 0 ? '+' : '-') + str;
}

module.exports = { formatarValor, interpretarInput, formatarVariacao };
