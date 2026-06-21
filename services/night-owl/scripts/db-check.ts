import { prisma } from '@argentinaradar/database';

async function main() {
  const count = await prisma.pattern.count();
  console.log('Patterns in DB:', count);

  const p = await prisma.pattern.create({
    data: {
      type: 'weekly',
      entityName: 'test_entity',
      description: 'Integration test pattern',
      confidence: 0.85,
      metadata: { source: 'integration-test' },
    },
  });
  console.log('Created pattern:', p.id);

  await prisma.pattern.delete({ where: { id: p.id } });
  console.log('Cleaned up — DB integration OK');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('DB test failed:', e.message);
  process.exit(1);
});
