-- Adiciona referencia_dia
ALTER TABLE "leituras" ADD COLUMN IF NOT EXISTS "referencia_dia" INTEGER;
UPDATE "leituras" SET "referencia_dia" = 1 WHERE "referencia_dia" IS NULL;
ALTER TABLE "leituras" ALTER COLUMN "referencia_dia" SET NOT NULL;

-- Adiciona editado_por_id
ALTER TABLE "leituras" ADD COLUMN IF NOT EXISTS "editado_por_id" TEXT;
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_editado_por_id_fkey" 
  FOREIGN KEY ("editado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Remove unique antigo e cria novo
ALTER TABLE "leituras" DROP CONSTRAINT IF EXISTS "leituras_medidor_id_referencia_mes_referencia_ano_key";
ALTER TABLE "leituras" ADD CONSTRAINT "leituras_medidor_id_referencia_dia_referencia_mes_referencia_ano_key" 
  UNIQUE ("medidor_id", "referencia_dia", "referencia_mes", "referencia_ano");

-- Cria index
CREATE INDEX IF NOT EXISTS "leituras_medidor_id_referencia_mes_referencia_ano_idx" 
  ON "leituras"("medidor_id", "referencia_mes", "referencia_ano");
