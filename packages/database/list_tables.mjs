import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const tables = await p.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log('Tables:', tables.map(t => t.table_name).join(', '));
} catch(e) {
  console.error('Error:', e.message);
} finally {
  await p.$disconnect();
}
