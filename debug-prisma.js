import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

try {
  console.log("Instantiating PrismaClient...");
  const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error']
  });
  console.log("PrismaClient instantiated successfully!");
  process.exit(0);
} catch (err) {
  console.error("Prisma constructor failed:");
  console.error(err);
  process.exit(1);
}
