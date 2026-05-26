const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed...');

  // Admin
  const admin = await prisma.user.upsert({
    where: { email: 'admin@medidor.app' },
    update: {},
    create: {
      email: 'admin@medidor.app',
      senha: await bcrypt.hash('admin123', 10),
      nome: 'Administrador',
      role: 'ADMIN',
    },
  });
  console.log('✓ Admin criado:', admin.email);

  // Gestor de exemplo
  const gestor = await prisma.user.upsert({
    where: { email: 'gestor@medidor.app' },
    update: {},
    create: {
      email: 'gestor@medidor.app',
      senha: await bcrypt.hash('gestor123', 10),
      nome: 'Gestor Exemplo',
      role: 'GESTOR',
    },
  });
  console.log('✓ Gestor criado:', gestor.email);

  // Leitor de exemplo
  const leitor = await prisma.user.upsert({
    where: { email: 'leitor@medidor.app' },
    update: {},
    create: {
      email: 'leitor@medidor.app',
      senha: await bcrypt.hash('leitor123', 10),
      nome: 'Leitor Exemplo',
      role: 'LEITOR',
    },
  });
  console.log('✓ Leitor criado:', leitor.email);

  // Condomínio de exemplo
  const condo = await prisma.condominio.upsert({
    where: { id: 'seed-condo-01' },
    update: {},
    create: {
      id: 'seed-condo-01',
      nome: 'Residencial Exemplo',
      endereco: 'Rua das Flores, 100',
      cidade: 'São Paulo',
    },
  });
  console.log('✓ Condomínio criado:', condo.nome);

  // Vincula gestor ao condomínio
  await prisma.condominioGestor.upsert({
    where: { condominio_id_user_id: { condominio_id: condo.id, user_id: gestor.id } },
    update: {},
    create: { condominio_id: condo.id, user_id: gestor.id },
  });

  // Unidades + medidores de exemplo
  const unidades = ['Apto 101', 'Apto 102', 'Apto 201', 'Apto 202'];
  for (const ident of unidades) {
    const unidade = await prisma.unidade.create({
      data: {
        condominio_id: condo.id,
        identificador: ident,
        andar: ident.includes('1') ? '1º andar' : '2º andar',
      },
    });
    await prisma.medidor.create({
      data: {
        unidade_id: unidade.id,
        tipo: 'AGUA',
        numero_serie: `MED-${Math.floor(Math.random() * 90000) + 10000}`,
      },
    });
  }
  console.log(`✓ ${unidades.length} unidades + medidores criados`);

  console.log('\n✅ Seed concluído!');
  console.log('   admin@medidor.app   / admin123');
  console.log('   gestor@medidor.app  / gestor123');
  console.log('   leitor@medidor.app  / leitor123');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
