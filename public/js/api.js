'use strict';

const API = {
  _token: () => localStorage.getItem('token'),

  _fetch: async (method, path, body, isForm = false) => {
    const headers = { Authorization: `Bearer ${API._token()}` };
    if (!isForm) headers['Content-Type'] = 'application/json';

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: isForm ? body : (body ? JSON.stringify(body) : undefined),
    });

    if (res.status === 401) { Auth.logout(); return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro desconhecido');
    return data;
  },

  get:    (path)         => API._fetch('GET',    path),
  post:   (path, body)   => API._fetch('POST',   path, body),
  put:    (path, body)   => API._fetch('PUT',    path, body),
  delete: (path)         => API._fetch('DELETE', path),
  form:   (path, form)   => API._fetch('POST',   path, form, true),

  // Auth
  login: (email, senha) => API.post('/auth/login', { email, senha }),

  // Dashboard
  dashboard: (condominio_id) => API.get('/leituras/dashboard' + (condominio_id ? `?condominio_id=${condominio_id}` : '')),

  // Condomínios
  condominios: {
    listar: () => API.get('/condominios'),
    buscar: (id) => API.get(`/condominios/${id}`),
    criar:  (d)  => API.post('/condominios', d),
    editar: (id, d) => API.put(`/condominios/${id}`, d),
  },

  // Unidades
  unidades: {
    listar: (condominio_id) => API.get(`/unidades?condominio_id=${condominio_id}`),
    criar:  (d) => API.post('/unidades', d),
  },

  // Medidores
  medidores: {
    listar: (unidade_id) => API.get(`/medidores${unidade_id ? `?unidade_id=${unidade_id}` : ''}`),
    listarPorCondo: (condominio_id) => API.get(`/medidores?condominio_id=${condominio_id}`),
    criar:  (d) => API.post('/medidores', d),
  },

  // Leituras
  leituras: {
    analisar:  (form) => API.form('/leituras/analisar', form),
    registrar: (form) => API.form('/leituras', form),
    editar:    (id, d) => API.put(`/leituras/${id}`, d),
    buscarDia: (medidor_id) => API.get(`/leituras/dia/${medidor_id}`),
    listar:    (q)    => API.get('/leituras?' + new URLSearchParams(q).toString()),
    relatorio: (q)    => API.get('/leituras/relatorio?' + new URLSearchParams(q).toString()),
  },

  // Users
  users: {
    listar: ()      => API.get('/users'),
    criar:  (d)     => API.post('/users', d),
    editar: (id, d) => API.put(`/users/${id}`, d),
    remover:(id)    => API.delete(`/users/${id}`),
  },
};
