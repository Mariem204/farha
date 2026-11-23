#!/usr/bin/env python3
"""Versions figées des modèles (templates/*.html) pour que les invitations déjà envoyées ne changent pas.

À lancer avant chaque mise en prod qui modifie un modèle :
    python3 scripts/template-versions.py

- Chaque version d'un modèle est copiée dans templates/v/<modèle>/<empreinte>.html
  (empreinte = 12 premiers caractères du SHA-256 du fichier, calculée de la même façon par le site).
- Un lien d'invitation créé maintenant garde l'empreinte de la version utilisée (champ « v ») :
  il s'affiche toujours avec cette version, même si le modèle change ensuite.
- Pour les liens créés avant ce système (sans « v ») : on prend la version qui était en ligne
  à la date de création du lien (liens courts), ou, faute de date, celle du 23/11/2026 12:35 UTC.
  L'historique (date de mise en prod → empreinte) est écrit dans index.html (bloc FARHA-VERSIONS).
"""
import hashlib, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SINCE = '2026-11-23T12:35:00+00:00'   # avant : liens sans date → version en ligne à ce moment-là
BRANCH = 'origin/main'

def git(*a):
    return subprocess.run(['git', '-C', ROOT] + list(a), capture_output=True, check=True).stdout

def h(b):
    return hashlib.sha256(b).hexdigest()[:12]

def snapshot(tid, data):
    d = os.path.join(ROOT, 'templates', 'v', tid)
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h(data) + '.html')
    if not os.path.exists(p):
        open(p, 'wb').write(data)

commits = [l.split(' ', 1) for l in git('log', BRANCH, '--first-parent', '--format=%H %cI').decode().split('\n') if l.strip()]
commits.reverse()  # du plus ancien au plus récent
history = {}
ids = sorted(f[:-5] for f in os.listdir(os.path.join(ROOT, 'templates')) if f.endswith('.html') and not f.startswith('_'))
for tid in ids:
    path = 'templates/%s.html' % tid
    entries, last = [], None
    for sha, date in commits:
        try:
            data = git('show', '%s:%s' % (sha, path))
        except subprocess.CalledProcessError:
            continue
        v = h(data)
        if v == last:
            continue
        last = v
        # versions remplacées avant SINCE : seule la dernière d'entre elles compte (elle était en ligne à SINCE)
        if date < SINCE and entries and entries[-1][0] < SINCE:
            entries[-1] = [date, v, data]
        else:
            entries.append([date, v, data])
    cur = open(os.path.join(ROOT, path), 'rb').read()
    if not entries or entries[-1][1] != h(cur):
        entries.append(['', h(cur), cur])  # version de travail (pas encore en prod) : date fixée à la mise en prod
    for e in entries:
        snapshot(tid, e[2])
    history[tid] = [[e[0], e[1]] for e in entries]

block = ('<script id="farha-versions">window.FARHA_TPL_HISTORY=' + json.dumps(history, separators=(',', ':')) +
         ';window.FARHA_TPL_SINCE="' + SINCE + '";</script>')
idx = os.path.join(ROOT, 'index.html')
s = open(idx, encoding='utf-8').read()
s2, n = re.subn(r'<script id="farha-versions">.*?</script>', lambda m: block, s, flags=re.S)
if not n:
    s2 = s.replace('</head>', block + '\n</head>', 1)
open(idx, 'w', encoding='utf-8').write(s2)
print('%d modèles, %d versions' % (len(history), sum(len(v) for v in history.values())))
for tid, e in history.items():
    if len(e) > 1:
        print(' ', tid, ' → '.join(x[1] + ('@' + x[0][:16] if x[0] else '@(à venir)') for x in e))
