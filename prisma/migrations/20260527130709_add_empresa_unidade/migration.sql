/*
  Warnings:

  - You are about to drop the column `andar` on the `unidades` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "leituras" ADD COLUMN     "empresa_snapshot" TEXT;

-- AlterTable
ALTER TABLE "unidades" DROP COLUMN "andar",
ADD COLUMN     "empresa" TEXT;
