// db.js — PostgreSQL + contas, sessões e fichas privadas por usuário
'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada. Adicione a URL do PostgreSQL nas variáveis de ambiente do Render.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const newId = (prefix) => prefix + crypto.randomBytes(16).toString('hex');
const now = () => new Date().toISOString();

function fichaPadrao() {
  return {
    charName: '',
    metaClasse: '',
    metaIdade: '',
    metaAltura: '',
    metaJogador: '',
    metaCampanha: '',
    attrs: { forca: 1, agilidade: 1, vigor: 1, intelecto: 1, carisma: 1 },
    afins: { forca: 0, vigor: 0, intelecto: 0, carisma: 0, agilidade: 0 },
    hpAtual: 20, hpMax: 20,
    sanAtual: 20, sanMax: 20,
    peAtual: 10, peMax: 10,
    recursoExtraAtual: 0, recursoExtraMax: 0,
    defTotal: 10,
    historico: '',
    notaSessao: '', notaNpcs: '', notaObjetivos: '', notaSegredos: '',
    tags: [],
    pericias: {},
    itens: [],
    habilidades: [],
    portrait: null
  };
}

function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const N = 16384, r = 8, p = 1;
  const hash = crypto.scryptSync(String(senha), salt, 64, { N, r, p }).toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

function verificarSenha(senha, armazenada) {
  try {
    const [, N, r, p, salt, hash] = String(armazenada).split('$');
    const atual = crypto.scryptSync(String(senha), salt, 64, {
      N: Number(N), r: Number(r), p: Number(p)
    });
    const esperado = Buffer.from(hash, 'hex');
    return atual.length === esperado.length && crypto.timingSafeEqual(atual, esperado);
  } catch {
    return false;
  }
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      expira_em TIMESTAMPTZ NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personagens (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      nome TEXT NOT NULL DEFAULT 'Sem Nome',
      classe TEXT DEFAULT '',
      dados JSONB NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessoes_usuario_id ON sessoes(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_sessoes_expira_em ON sessoes(expira_em);
    CREATE INDEX IF NOT EXISTS idx_personagens_usuario_id ON personagens(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_personagens_atualizado_em ON personagens(atualizado_em DESC);
  `);
}

async function criarUsuario(email, senha) {
  const id = newId('usr_');
  const t = now();
  const e = normalizarEmail(email);
  const result = await pool.query(
    'INSERT INTO usuarios(id,email,senha_hash,criado_em) VALUES($1,$2,$3,$4) RETURNING id,email,criado_em',
    [id, e, hashSenha(senha), t]
  );
  return result.rows[0];
}

async function buscarUsuarioPorEmail(email) {
  const result = await pool.query('SELECT * FROM usuarios WHERE email=$1 LIMIT 1', [normalizarEmail(email)]);
  return result.rows[0] || null;
}

async function buscarUsuario(id) {
  const result = await pool.query('SELECT id,email,criado_em FROM usuarios WHERE id=$1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

async function criarSessao(usuarioId, dias = 30) {
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const t = now();
  const exp = new Date(Date.now() + dias * 86400000).toISOString();
  await pool.query(
    'INSERT INTO sessoes(id,usuario_id,expira_em,criado_em) VALUES($1,$2,$3,$4)',
    [hash, usuarioId, exp, t]
  );
  return { token, expira_em: exp };
}

async function usuarioDaSessao(token) {
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await pool.query(
    `SELECT u.id,u.email,u.criado_em
       FROM sessoes s
       JOIN usuarios u ON u.id=s.usuario_id
      WHERE s.id=$1 AND s.expira_em > NOW()
      LIMIT 1`,
    [hash]
  );
  return result.rows[0] || null;
}

async function removerSessao(token) {
  if (!token) return;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await pool.query('DELETE FROM sessoes WHERE id=$1', [hash]);
}

async function limparSessoesExpiradas() {
  await pool.query('DELETE FROM sessoes WHERE expira_em <= NOW()');
}

async function listar(usuarioId) {
  const result = await pool.query(
    `SELECT id,nome,classe,criado_em,atualizado_em
       FROM personagens
      WHERE usuario_id=$1
      ORDER BY atualizado_em DESC`,
    [usuarioId]
  );
  return result.rows;
}

async function buscar(usuarioId, personagemId) {
  const result = await pool.query(
    `SELECT id,nome,classe,criado_em,atualizado_em,dados
       FROM personagens
      WHERE id=$1 AND usuario_id=$2
      LIMIT 1`,
    [personagemId, usuarioId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, dados: typeof row.dados === 'string' ? JSON.parse(row.dados) : row.dados };
}

async function criar(usuarioId, { nome, dados } = {}) {
  const id = newId('pj_');
  const t = now();
  const dadosFinal = { ...fichaPadrao(), ...(dados || {}) };
  const nomeFinal = String(nome || dadosFinal.charName || 'Novo Personagem').trim() || 'Novo Personagem';
  const result = await pool.query(
    `INSERT INTO personagens(id,usuario_id,nome,classe,dados,criado_em,atualizado_em)
     VALUES($1,$2,$3,$4,$5,$6,$6)
     RETURNING id,nome,classe,criado_em,atualizado_em,dados`,
    [id, usuarioId, nomeFinal, dadosFinal.metaClasse || '', JSON.stringify(dadosFinal), t]
  );
  const row = result.rows[0];
  return { ...row, dados: row.dados };
}

async function atualizar(usuarioId, personagemId, { nome, dados } = {}) {
  const existente = await buscar(usuarioId, personagemId);
  if (!existente) return null;

  const t = now();
  const dadosFinal = dados !== undefined ? dados : existente.dados;
  const nomeFinal = nome !== undefined
    ? (String(nome || '').trim() || 'Sem Nome')
    : (dadosFinal.charName || existente.nome);

  const result = await pool.query(
    `UPDATE personagens
        SET nome=$1, classe=$2, dados=$3, atualizado_em=$4
      WHERE id=$5 AND usuario_id=$6
      RETURNING id,nome,classe,criado_em,atualizado_em,dados`,
    [nomeFinal, dadosFinal.metaClasse || '', JSON.stringify(dadosFinal), t, personagemId, usuarioId]
  );

  const row = result.rows[0];
  if (!row) return null;
  return { ...row, dados: row.dados };
}

async function remover(usuarioId, personagemId) {
  const result = await pool.query(
    'DELETE FROM personagens WHERE id=$1 AND usuario_id=$2',
    [personagemId, usuarioId]
  );
  return result.rowCount > 0;
}

async function fechar() {
  await pool.end();
}

module.exports = {
  init,
  fechar,
  fichaPadrao,
  normalizarEmail,
  criarUsuario,
  buscarUsuarioPorEmail,
  buscarUsuario,
  verificarSenha,
  criarSessao,
  usuarioDaSessao,
  removerSessao,
  limparSessoesExpiradas,
  listar,
  buscar,
  criar,
  atualizar,
  remover
};
