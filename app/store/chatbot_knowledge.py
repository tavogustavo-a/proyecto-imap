# -*- coding: utf-8 -*-
"""Base de conocimiento y respuestas para el chatbot respuestas-preguntas (sin costo obligatorio)."""
from __future__ import annotations

import json
import os
import re
import shutil
from typing import Any, Dict, List, Optional, Tuple

import requests

_TOKEN_RE = re.compile(r'[a-záéíóúñ0-9]+', re.IGNORECASE)
_SOURCES_FILE = 'sources.json'
_MAX_CHUNK = 900


def knowledge_dir(app) -> str:
    path = os.path.join(app.instance_path, 'chatbot_knowledge')
    os.makedirs(path, exist_ok=True)
    return path


def _defaults_dir() -> str:
    return os.path.join(os.path.dirname(__file__), 'knowledge_defaults')


def ensure_default_knowledge(app) -> None:
    """Copia markdown por defecto la primera vez."""
    dest = knowledge_dir(app)
    flag = os.path.join(dest, '.defaults_installed')
    if os.path.isfile(flag):
        return
    src = _defaults_dir()
    if os.path.isdir(src):
        for name in os.listdir(src):
            if name.endswith('.md'):
                shutil.copy2(os.path.join(src, name), os.path.join(dest, name))
    with open(flag, 'w', encoding='utf-8') as f:
        f.write('ok')


def _sources_path(app) -> str:
    return os.path.join(knowledge_dir(app), _SOURCES_FILE)


def list_sources(app) -> List[Dict[str, Any]]:
    ensure_default_knowledge(app)
    path = _sources_path(app)
    items: List[Dict[str, Any]] = []
    if os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw = json.load(f)
            if isinstance(raw, list):
                items = raw
        except Exception:
            items = []
    builtin_ids = {it.get('id') for it in items}
    for name in sorted(os.listdir(knowledge_dir(app))):
        if not name.endswith('.md'):
            continue
        bid = f'file:{name}'
        if bid in builtin_ids:
            continue
        items.append({
            'id': bid,
            'title': name.replace('.md', '').replace('_', ' ').title(),
            'type': 'builtin',
            'created_at': '',
        })
    return items


def add_source(app, title: str, content: str, source_type: str = 'note', meta: Optional[dict] = None) -> Dict[str, Any]:
    ensure_default_knowledge(app)
    title_s = (title or 'Nota').strip()[:120]
    body = (content or '').strip()
    if not body:
        raise ValueError('El contenido no puede estar vacío')
    entry = {
        'id': f'custom_{int(__import__("time").time())}',
        'title': title_s,
        'type': source_type,
        'content': body[:50000],
        'meta': meta or {},
        'created_at': __import__('datetime').datetime.utcnow().strftime('%Y-%m-%d %H:%M'),
    }
    path = _sources_path(app)
    items = []
    if os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                items = json.load(f) or []
        except Exception:
            items = []
    if not isinstance(items, list):
        items = []
    items.insert(0, entry)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(items[:200], f, ensure_ascii=False, indent=2)
    return entry


def _tokenize(text: str) -> List[str]:
    return [t.lower() for t in _TOKEN_RE.findall(text or '') if len(t) > 2]


def _all_chunks(app) -> List[Dict[str, str]]:
    ensure_default_knowledge(app)
    chunks: List[Dict[str, str]] = []
    base = knowledge_dir(app)
    for name in sorted(os.listdir(base)):
        if not name.endswith('.md'):
            continue
        fp = os.path.join(base, name)
        try:
            with open(fp, 'r', encoding='utf-8') as f:
                text = f.read()
        except Exception:
            continue
        title = name.replace('.md', '')
        for i, part in enumerate(_split_text(text)):
            chunks.append({'title': title, 'text': part, 'source': name})

    path = _sources_path(app)
    if os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                items = json.load(f)
        except Exception:
            items = []
        if isinstance(items, list):
            for it in items:
                if not isinstance(it, dict):
                    continue
                body = str(it.get('content') or '')
                tit = str(it.get('title') or 'Nota')
                url = (it.get('meta') or {}).get('youtube_url', '')
                header = tit
                if url:
                    header += f' ({url})'
                for part in _split_text(body):
                    chunks.append({'title': tit, 'text': part, 'source': header})

    return chunks


def _split_text(text: str) -> List[str]:
    parts: List[str] = []
    buf = ''
    for line in (text or '').splitlines():
        if len(buf) + len(line) + 1 > _MAX_CHUNK and buf.strip():
            parts.append(buf.strip())
            buf = line + '\n'
        else:
            buf += line + '\n'
    if buf.strip():
        parts.append(buf.strip())
    return parts or ['']


def search_knowledge(app, query: str, limit: int = 8) -> List[Dict[str, str]]:
    tokens = _tokenize(query)
    if not tokens:
        return []
    scored: List[Tuple[int, Dict[str, str]]] = []
    for ch in _all_chunks(app):
        low = ch['text'].lower()
        score = sum(2 if t in low else 0 for t in tokens)
        if score > 0:
            scored.append((score, ch))
    scored.sort(key=lambda x: -x[0])
    return [c for _, c in scored[:limit]]


def format_context(chunks: List[Dict[str, str]]) -> str:
    if not chunks:
        return '(Sin fragmentos relevantes en la base de conocimiento.)'
    lines = []
    for i, ch in enumerate(chunks, 1):
        lines.append(f'[{i}] ({ch.get("title", "")})\n{ch.get("text", "")}')
    return '\n\n'.join(lines)


def answer_without_llm(query: str, chunks: List[Dict[str, str]]) -> str:
    if not chunks:
        return 'No encontré información en la base de conocimiento para esa pregunta.'
    intro = 'Según la documentación interna:\n\n'
    body = '\n\n'.join(f'• {c["text"][:500]}' for c in chunks[:4])
    return intro + body


def _call_gemini(api_key: str, system: str, user_msg: str) -> Optional[str]:
    url = (
        'https://generativelanguage.googleapis.com/v1beta/models/'
        f'gemini-2.0-flash:generateContent?key={api_key}'
    )
    payload = {
        'contents': [
            {
                'role': 'user',
                'parts': [{'text': f'{system}\n\n---\n\nPregunta del agente:\n{user_msg}'}],
            }
        ],
        'generationConfig': {'temperature': 0.35, 'maxOutputTokens': 1024},
    }
    try:
        r = requests.post(url, json=payload, timeout=45)
        if r.status_code != 200:
            return None
        data = r.json()
        cands = data.get('candidates') or []
        if not cands:
            return None
        parts = (cands[0].get('content') or {}).get('parts') or []
        texts = [p.get('text', '') for p in parts if p.get('text')]
        return '\n'.join(texts).strip() or None
    except Exception:
        return None


def _call_groq(api_key: str, system: str, user_msg: str) -> Optional[str]:
    url = 'https://api.groq.com/openai/v1/chat/completions'
    headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}
    payload = {
        'model': 'llama-3.3-70b-versatile',
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user_msg},
        ],
        'temperature': 0.35,
        'max_tokens': 1024,
    }
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=45)
        if r.status_code != 200:
            return None
        data = r.json()
        choices = data.get('choices') or []
        if not choices:
            return None
        return (choices[0].get('message') or {}).get('content', '').strip() or None
    except Exception:
        return None


def generate_answer(app, query: str, history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    chunks = search_knowledge(app, query)
    context = format_context(chunks)
    hist_txt = ''
    if history:
        lines = []
        for h in history[-6:]:
            role = h.get('role', 'user')
            txt = str(h.get('content', ''))[:800]
            if txt:
                lines.append(f'{role}: {txt}')
        hist_txt = '\n'.join(lines)

    system = (
        'Eres un asistente de soporte para agentes de un portal de licencias, tienda y consulta de códigos IMAP. '
        'Responde en español, claro y breve. Usa SOLO la información del contexto; si no alcanza, dilo y sugiere qué revisar. '
        'No inventes precios ni políticas.\n\n'
        f'CONTEXTO:\n{context}\n'
    )
    if hist_txt:
        system += f'\nHISTORIAL RECIENTE:\n{hist_txt}\n'

    gemini_key = os.getenv('GEMINI_API_KEY') or app.config.get('GEMINI_API_KEY')
    groq_key = os.getenv('GROQ_API_KEY') or app.config.get('GROQ_API_KEY')

    answer = None
    engine = 'local'
    if gemini_key:
        answer = _call_gemini(gemini_key, system, query)
        if answer:
            engine = 'gemini'
    if not answer and groq_key:
        answer = _call_groq(groq_key, system, query)
        if answer:
            engine = 'groq'

    if not answer:
        answer = answer_without_llm(query, chunks)
        engine = 'local'

    return {
        'answer': answer,
        'engine': engine,
        'sources': [{'title': c.get('title'), 'source': c.get('source')} for c in chunks[:5]],
    }
