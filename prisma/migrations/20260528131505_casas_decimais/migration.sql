-- AlterTable
ALTER TABLE "leituras" ALTER COLUMN "valor" SET DATA TYPE DECIMAL(12,3);

-- AlterTable
ALTER TABLE "medidores" ADD COLUMN     "casas_decimais" INTEGER NOT NULL DEFAULT 3;
