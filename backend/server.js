// server.js — API REST do backend da Ficha Paleora RPG
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ''; // deixe vazio para desativar autenticação

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '15mb' })); // limite maior por causa do retrato em base64

// Autenticação simples por chave (opcional). Defina API_KEY no .env para ativar.
app.use((req, res, next) => {
  if (!API_KEY) return next();
  if (req.path === '/api/health') return next();
  const chave = req.header('x-api-key');
  if (chave !== API_KEY) {
    return res.status(401).json({ erro: 'Chave de API inválida ou ausente (header x-api-key).' });
  }
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hora: new Date().toISOString() });
});

// Lista todos os personagens (versão resumida, sem os "dados" completos)
app.get('/api/personagens', (req, res) => {
  try {
    res.json(db.listar());
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao listar personagens.' });
  }
});

// Busca um personagem completo
app.get('/api/personagens/:id', (req, res) => {
  try {
    const p = db.buscar(req.params.id);
    if (!p) return res.status(404).json({ erro: 'Personagem não encontrado.' });
    res.json(p);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao buscar personagem.' });
  }
});

// Cria um novo personagem
app.post('/api/personagens', (req, res) => {
  try {
    const { nome, dados } = req.body || {};
    const p = db.criar({ nome, dados });
    res.status(201).json(p);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao criar personagem.' });
  }
});

// Atualiza (salva) um personagem existente
app.put('/api/personagens/:id', (req, res) => {
  try {
    const { nome, dados } = req.body || {};
    const p = db.atualizar(req.params.id, { nome, dados });
    if (!p) return res.status(404).json({ erro: 'Personagem não encontrado.' });
    res.json(p);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao salvar personagem.' });
  }
});

// Remove um personagem
app.delete('/api/personagens/:id', (req, res) => {
  try {
    const ok = db.remover(req.params.id);
    if (!ok) return res.status(404).json({ erro: 'Personagem não encontrado.' });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao remover personagem.' });
  }
});

app.listen(PORT, () => {
  console.log(`✦ Backend Paleora RPG rodando em http://localhost:${PORT}`);
  console.log(API_KEY ? '  Autenticação por API key: ATIVA' : '  Autenticação por API key: desativada (defina API_KEY no .env para ativar)');
});
