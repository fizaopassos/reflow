-- CreateTable
CREATE TABLE "condominio_leitores" (
    "condominio_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "condominio_leitores_pkey" PRIMARY KEY ("condominio_id","user_id")
);

-- AddForeignKey
ALTER TABLE "condominio_leitores" ADD CONSTRAINT "condominio_leitores_condominio_id_fkey" FOREIGN KEY ("condominio_id") REFERENCES "condominios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "condominio_leitores" ADD CONSTRAINT "condominio_leitores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
