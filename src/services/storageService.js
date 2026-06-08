'use strict';

const sharp = require('sharp');
const { Storage } = require('@google-cloud/storage');

const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const bucket = storage.bucket(process.env.GCS_BUCKET);

/**
 * Faz upload de um buffer para o GCS.
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {string} mimetype
 * @returns {Promise<string>} caminho no bucket (ex: "fotos/123456-foto.jpg")
 */
async function uploadFoto(buffer, filename, mimetype) {
  // Comprime para JPEG, máximo 1200px de largura, qualidade 75
  const comprimido = await sharp(buffer)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer();

  const destino = `fotos/${Date.now()}-${filename.replace(/\.[^.]+$/, '')}.jpg`;
  const file = bucket.file(destino);

  await file.save(comprimido, {
    metadata: { contentType: 'image/jpeg' },
    resumable: false,
  });

  return destino;
}

/**
 * Gera uma Signed URL temporária para visualização (1 hora).
 * @param {string} caminho  ex: "fotos/123456-foto.jpg"
 * @returns {Promise<string>} URL assinada
 */
async function gerarSignedUrl(caminho) {
  const [url] = await bucket.file(caminho).getSignedUrl({
    action: 'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hora
  });
  return url;
}

module.exports = { uploadFoto, gerarSignedUrl };
