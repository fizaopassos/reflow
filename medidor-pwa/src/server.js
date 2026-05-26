require('dotenv').config();
const express = require('express');
const path    = require('path');

const routes = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3005;

// ── MIDDLEWARES ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos: uploads e PWA
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../public')));

// ── API ───────────────────────────────────────────────────────
app.use('/api', routes);

// ── SPA FALLBACK ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor.', detalhe: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando em http://0.0.0.0:${PORT}`);
});
