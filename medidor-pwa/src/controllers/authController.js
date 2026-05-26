const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const prisma = require('../utils/prisma');

async function login(req, res) {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ erro: 'Email e senha são obrigatórios.' });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.ativo) {
    return res.status(401).json({ erro: 'Credenciais inválidas.' });
  }

  const senhaOk = await bcrypt.compare(senha, user.senha);
  if (!senhaOk) {
    return res.status(401).json({ erro: 'Credenciais inválidas.' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, nome: user.nome, role: user.role, is_admin_local: user.is_admin_local },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, nome: user.nome, role: user.role }
  });
}

module.exports = { login };
