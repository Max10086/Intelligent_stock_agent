import 'dotenv/config';
import { prisma } from '../db.js';

const TARGET_EMAIL = (process.argv[2] || 'yepu100@163.com').trim().toLowerCase();

async function main() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) {
    throw new Error(`User not found: ${TARGET_EMAIL}`);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: true },
    select: { id: true, email: true, isAdmin: true, isPaid: true },
  });

  console.log('Super admin enabled:', updated);
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
