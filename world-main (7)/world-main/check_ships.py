content = open('main.py','r',encoding='utf-8').read()
idx = content.find('AISHub fetch failed')
print(repr(content[idx-200:idx+300]))
