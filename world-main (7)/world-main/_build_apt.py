import json
from collections import defaultdict

src = r'C:\Users\KIIT\Downloads\skills-main\APTmap-master\APTmap-master\apt_rel.json'
out = r'C:\Users\KIIT\Downloads\skills-main\worldmonitor-local\apt_full.json'

with open(src, encoding='utf-8') as f:
    data = json.load(f)

nodes_by_id = {n['id']: n for n in data['nodes']}
fwd = defaultdict(list)
for l in data['links']:
    fwd[l['source']].append(l['target'])

result = []
for node in data['nodes']:
    if node.get('group') != 'APT':
        continue
    nid = node['id']
    country = None
    tools = []
    ttps = []
    for t in fwd.get(nid, []):
        n = nodes_by_id.get(t)
        if not n:
            continue
        g = n.get('group', '')
        if g == 'Country' and country is None:
            country = n['name']
        elif g == 'Tool' and len(tools) < 15:
            tools.append(n['name'])
        elif g == 'TTP' and len(ttps) < 10:
            ttps.append(n['name'])

    desc = node.get('description', '').replace('\n', ' ').strip()
    if len(desc) > 400:
        desc = desc[:397] + '...'

    result.append({
        'name': node['name'],
        'description': desc,
        'country': country or '',
        'tools': tools,
        'ttps': ttps,
        'color': node.get('color', '#ffd700')
    })

output = {'apt_groups': result, 'total': len(result)}
import tempfile, os

tmp = os.path.join(tempfile.gettempdir(), 'apt_full.json')
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

size = os.path.getsize(tmp)
print(f'DONE: {len(result)} groups written to {tmp} ({size/1024:.1f} KB)')
