const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Usuários
  const admin = await prisma.user.upsert({
    where: { email: 'admin@reflow.app' },
    update: {},
    create: {
      email: 'admin@reflow.app',
      senha: await bcrypt.hash('admin123', 10),
      nome: 'Administrador',
      role: 'ADMIN',
    },
  });

  const gestor = await prisma.user.upsert({
    where: { email: 'gestor@reflow.app' },
    update: {},
    create: {
      email: 'gestor@reflow.app',
      senha: await bcrypt.hash('gestor123', 10),
      nome: 'Gestor Exemplo',
      role: 'GESTOR',
    },
  });

  const leitor = await prisma.user.upsert({
    where: { email: 'leitor@reflow.app' },
    update: {},
    create: {
      email: 'leitor@reflow.app',
      senha: await bcrypt.hash('leitor123', 10),
      nome: 'Leitor Exemplo',
      role: 'LEITOR',
    },
  });

  console.log('✓ Usuários criados');

  // Condomínio (galpão)
  const galpao = await prisma.condominio.upsert({
    where: { id: 'seed-galpao-01' },
    update: {},
    create: {
      id: 'seed-galpao-01',
      nome: 'Galpão Retha Embu',
      endereco: 'Rod. Régis Bittencourt, km 282',
      cidade: 'Embu das Artes',
    },
  });

  // Vincula gestor e leitor ao galpão
  await prisma.condominioGestor.upsert({
    where: { condominio_id_user_id: { condominio_id: galpao.id, user_id: gestor.id } },
    update: {},
    create: { condominio_id: galpao.id, user_id: gestor.id },
  });

  await prisma.condominioLeitor.upsert({
    where: { condominio_id_user_id: { condominio_id: galpao.id, user_id: leitor.id } },
    update: {},
    create: { condominio_id: galpao.id, user_id: leitor.id },
  });

  console.log('✓ Galpão criado e vínculos feitos');

  // Unidades com empresas
  const unidades = [
    { bloco: 'Bloco A', identificador: 'Unidade 01', empresa: 'Amazon Logística Ltda' },
    { bloco: 'Bloco A', identificador: 'Unidade 02', empresa: 'Mercado Livre S.A.' },
    { bloco: 'Bloco B', identificador: 'Unidade 01', empresa: 'DHL Supply Chain' },
    { bloco: 'Bloco B', identificador: 'Unidade 02', empresa: null },
  ];

  for (const u of unidades) {
    const unidade = await prisma.unidade.create({
      data: { condominio_id: galpao.id, ...u },
    });
    await prisma.medidor.create({
      data: {
        unidade_id: unidade.id,
        tipo: 'AGUA',
        numero_serie: `MED-${Math.floor(Math.random() * 90000) + 10000}`,
      },
    });
  }

  console.log('✓ Unidades e medidores criados');
  console.log('\n✅ Seed concluído!');
  console.log('   admin@reflow.app   / admin123');
  console.log('   gestor@reflow.app  / gestor123');
  console.log('   leitor@reflow.app  / leitor123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
