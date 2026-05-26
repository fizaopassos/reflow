-- DropIndex
DROP INDEX "leituras_medidor_id_referencia_mes_referencia_ano_key";

-- RenameIndex
ALTER INDEX "leituras_medidor_id_referencia_dia_referencia_mes_referencia_an" RENAME TO "leituras_medidor_id_referencia_dia_referencia_mes_referenci_key";
