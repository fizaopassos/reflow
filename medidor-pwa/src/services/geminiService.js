const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const PROMPT = `Você é um sistema especialista em leitura de medidores (água, energia, gás).

Analise esta imagem e extraia a leitura do medidor. Responda SOMENTE com JSON válido, sem markdown, sem comentários:
{
  "valor_inteiro": "12345",
  "valor_decimal": "678",
  "tem_decimal": true,
  "valor_completo": "12345.678",
  "unidade": "m³",
  "confianca": "alta",
  "observacoes": "Leitura clara. Mostrador em bom estado."
}

Regras:
- "valor_inteiro": dígitos principais (parte preta/branca)
- "valor_decimal": dígitos decimais (parte vermelha), vazio se não houver
- "valor_completo": número final com ponto decimal (ex: "12345.678" ou "12345")
- "confianca": "alta", "média" ou "baixa"
- "observacoes": descrição breve do que viu (máx 120 chars)
- Se não for um medidor ou não conseguir ler: valor_completo: "ERRO", explique em observacoes`;

async function analisarImagem(base64, mime) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY não configurada.');

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mime, data: base64 } },
          { text: PROMPT }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { analisarImagem };
