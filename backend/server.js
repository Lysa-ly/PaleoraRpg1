// server.js — API REST Paleora RPG com PostgreSQL e fichas privadas por usuário
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PROD = process.env.NODE_ENV === 'production';

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: '15mb' }));

function cookie(req, name) {
  const header = req.headers.cookie || '';
  const part = header.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

function setCookie(res, token, maxAge = 2592000) {
  const secure = PROD ? '; Secure' : '';
  const sameSite = PROD ? 'SameSite=None' : 'SameSite=Lax';
  res.setHeader(
    'Set-Cookie',
    `paleora_session=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; ${sameSite}${secure}`
  );
}

function clearCookie(res) {
  setCookie(res, '', 0);
}

async function auth(req, res, next) {
  try {
    const token = cookie(req, 'paleora_session');
    const usuario = await db.usuarioDaSessao(token);
    if (!usuario) return res.status(401).json({ erro: 'Não autenticado.' });
    req.usuario = usuario;
    req.sessionToken = token;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao validar a sessão.' });
  }
}

function origin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const o = req.headers.origin;
  if (ALLOWED_ORIGIN !== '*' && o && o !== ALLOWED_ORIGIN) {
    return res.status(403).json({ erro: 'Origem não autorizada.' });
  }
  next();
}

app.use(origin);

app.get('/api/health', async (req, res) => {
  try {
    await db.init();
    res.json({ status: 'ok', banco: 'postgresql', hora: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', erro: 'Banco de dados indisponível.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const email = db.normalizarEmail(req.body?.email);
    const senha = String(req.body?.senha || '');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    }
    if (senha.length < 8) {
      return res.status(400).json({ erro: 'A senha deve ter pelo menos 8 caracteres.' });
    }
    if (await db.buscarUsuarioPorEmail(email)) {
      return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
    }

    const usuario = await db.criarUsuario(email, senha);
    const sessao = await db.criarSessao(usuario.id);
    setCookie(res, sessao.token);
    res.status(201).json({ usuario });
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
    res.status(500).json({ erro: 'Não foi possível criar a conta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = db.normalizarEmail(req.body?.email);
    const senha = String(req.body?.senha || '');
    const usuario = await db.buscarUsuarioPorEmail(email);

    if (!usuario || !db.verificarSenha(senha, usuario.senha_hash)) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const sessao = await db.criarSessao(usuario.id);
    setCookie(res, sessao.token);
    res.json({ usuario: { id: usuario.id, email: usuario.email, criado_em: usuario.criado_em } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível entrar.' });
  }
});

app.get('/api/auth/me', auth, (req, res) => res.json({ usuario: req.usuario }));

app.post('/api/auth/logout', auth, async (req, res) => {
  try {
    await db.removerSessao(req.sessionToken);
    clearCookie(res);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Não foi possível sair.' });
  }
});

// A propriedade da ficha é SEMPRE determinada pelo usuário autenticado no servidor.
app.get('/api/personagens', auth, async (req, res) => {
  try {
    res.json(await db.listar(req.usuario.id));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao listar personagens.' });
  }
});

app.get('/api/personagens/:id', auth, async (req, res) => {
  try {
    const personagem = await db.buscar(req.usuario.id, req.params.id);
    if (!personagem) return res.status(404).json({ erro: 'Personagem não encontrado.' });
    res.json(personagem);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao buscar personagem.' });
  }
});

app.post('/api/personagens', auth, async (req, res) => {
  try {
    const { nome, dados } = req.body || {};
    res.status(201).json(await db.criar(req.usuario.id, { nome, dados }));
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao criar personagem.' });
  }
});

app.put('/api/personagens/:id', auth, async (req, res) => {
  try {
    const { nome, dados } = req.body || {};
    const personagem = await db.atualizar(req.usuario.id, req.params.id, { nome, dados });
    if (!personagem) return res.status(404).json({ erro: 'Personagem não encontrado.' });
    res.json(personagem);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao salvar personagem.' });
  }
});

app.delete('/api/personagens/:id', auth, async (req, res) => {
  try {
    const ok = await db.remover(req.usuario.id, req.params.id);
    if (!ok) return res.status(404).json({ erro: 'Personagem não encontrado.' });
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Falha ao remover personagem.' });
  }
});

async function start() {
  try {
    await db.init();
    await db.limparSessoesExpiradas();
    app.listen(PORT, () => {
      console.log(`✦ Backend Paleora RPG rodando na porta ${PORT}`);
      console.log('✦ Banco: PostgreSQL');
    });
  } catch (e) {
    console.error('Não foi possível iniciar o backend:', e);
    process.exit(1);
  }
}

start();

process.on('SIGTERM', async () => {
  await db.fechar();
  process.exit(0);
});
