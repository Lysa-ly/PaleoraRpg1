// db.js — Camada de acesso ao banco de dados (SQLite nativo do Node.js 22+)
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'paleora.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS personagens (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL DEFAULT 'Sem Nome',
    classe TEXT DEFAULT '',
    dados TEXT NOT NULL,
    criado_em TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );
`);

function uuid() {
  return 'pj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function nowISO() {
  return new Date().toISOString();
}

// Estado padrão de uma ficha nova — espelha a estrutura usada pelo front-end
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
    defTotal: 10, defArmadura: 0, defEsquiva: 0, defResistencia: 0,
    historico: '',
    notaSessao: '', notaNpcs: '', notaObjetivos: '', notaSegredos: '',
    tags: [],
    pericias: {},
    itens: [],
    habilidades: [],
    portrait: null
  };
}

function listar() {
  const rows = db.prepare(
    `SELECT id, nome, classe, criado_em, atualizado_em FROM personagens ORDER BY atualizado_em DESC`
  ).all();
  return rows;
}

function buscar(id) {
  const row = db.prepare(`SELECT * FROM personagens WHERE id = ?`).get(id);
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    classe: row.classe,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em,
    dados: JSON.parse(row.dados)
  };
}

function criar({ nome, dados } = {}) {
  const id = uuid();
  const ts = nowISO();
  const dadosFinal = { ...fichaPadrao(), ...(dados || {}) };
  const nomeFinal = nome || dadosFinal.charName || 'Novo Personagem';
  db.prepare(
    `INSERT INTO personagens (id, nome, classe, dados, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, nomeFinal, dadosFinal.metaClasse || '', JSON.stringify(dadosFinal), ts, ts);
  return buscar(id);
}

function atualizar(id, { nome, dados }) {
  const existente = buscar(id);
  if (!existente) return null;
  const ts = nowISO();
  const dadosFinal = dados !== undefined ? dados : existente.dados;
  const nomeFinal = nome !== undefined ? nome : (dadosFinal.charName || existente.nome);
  db.prepare(
    `UPDATE personagens SET nome = ?, classe = ?, dados = ?, atualizado_em = ? WHERE id = ?`
  ).run(nomeFinal, dadosFinal.metaClasse || '', JSON.stringify(dadosFinal), ts, id);
  return buscar(id);
}

function remover(id) {
  const info = db.prepare(`DELETE FROM personagens WHERE id = ?`).run(id);
  return info.changes > 0;
}

module.exports = { listar, buscar, criar, atualizar, remover, fichaPadrao };
