const express = require('express');
const multer  = require('multer');
const { auth, autorizar } = require('../middlewares/auth');

const authCtrl       = require('../controllers/authController');
const usersCtrl      = require('../controllers/usersController');
const condosCtrl     = require('../controllers/condominiosController');
const medidoresCtrl  = require('../controllers/medidoresController');
const leiturasCtrl   = require('../controllers/leiturasController');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── AUTH ──────────────────────────────────────────────────────
router.post('/auth/login', authCtrl.login);

// ── USERS (admin only) ────────────────────────────────────────
router.get   ('/users',        auth, autorizar('ADMIN'), usersCtrl.listar);
router.get   ('/users/:id',    auth, autorizar('ADMIN'), usersCtrl.buscar);
router.post  ('/users',        auth, autorizar('ADMIN'), usersCtrl.criar);
router.put   ('/users/:id',    auth, autorizar('ADMIN'), usersCtrl.atualizar);
router.delete('/users/:id',    auth, autorizar('ADMIN'), usersCtrl.remover);

// ── CONDOMÍNIOS ───────────────────────────────────────────────
router.get ('/condominios',                          auth, condosCtrl.listar);
router.get ('/condominios/:id',                      auth, condosCtrl.buscar);
router.post('/condominios',                          auth, autorizar('ADMIN'), condosCtrl.criar);
router.put ('/condominios/:id',                      auth, autorizar('ADMIN'), condosCtrl.atualizar);
router.post('/condominios/:id/gestores',             auth, autorizar('ADMIN'), condosCtrl.atribuirGestor);
router.delete('/condominios/:id/gestores/:userId',   auth, autorizar('ADMIN'), condosCtrl.removerGestor);

// ── UNIDADES ──────────────────────────────────────────────────
router.get ('/unidades',     auth, medidoresCtrl.listarUnidades);
router.post('/unidades',     auth, autorizar('ADMIN', 'GESTOR'), medidoresCtrl.criarUnidade);
router.put ('/unidades/:id', auth, autorizar('ADMIN', 'GESTOR'), medidoresCtrl.atualizarUnidade);

// ── MEDIDORES ─────────────────────────────────────────────────
router.get ('/medidores',     auth, medidoresCtrl.listarMedidores);
router.post('/medidores',     auth, autorizar('ADMIN', 'GESTOR'), medidoresCtrl.criarMedidor);
router.put ('/medidores/:id', auth, autorizar('ADMIN', 'GESTOR'), medidoresCtrl.atualizarMedidor);

// ── LEITURAS ──────────────────────────────────────────────────
router.post('/leituras/analisar',  auth, upload.single('imagem'), leiturasCtrl.analisar);
router.post('/leituras',           auth, upload.single('imagem'), leiturasCtrl.registrar);
router.get ('/leituras',           auth, leiturasCtrl.listar);
router.get ('/leituras/dashboard', auth, leiturasCtrl.dashboard);
router.get ('/leituras/relatorio', auth, leiturasCtrl.relatorio);

module.exports = router;
