import os, ast

f = r'c:\Users\KIIT\Downloads\skills-main\worldmonitor-local\main.py'
txt = open(f, encoding='utf-8').read()
print(f"Before: {len(txt.splitlines())} lines")

ANCHOR_START = '    # \u2500\u2500 kept only to satisfy old indentation'
ANCHOR_END   = '\n\n# \u2500'

idx_start = txt.find(ANCHOR_START)
idx_end   = txt.find(ANCHOR_END, idx_start + 10)
print(f"Dead block: chars {idx_start}..{idx_end}")
assert idx_start > 0 and idx_end > idx_start

new_txt = txt[:idx_start] + txt[idx_end:]
print(f"After: {len(new_txt.splitlines())} lines")
ast.parse(new_txt)
print("Syntax OK")

open(f, 'w', encoding='utf-8').write(new_txt)
print("Written")
for s in ['MOCK_VESSELS', '_process_mock_vessels', '_MOCK_PLACEHOLDER']:
    n = new_txt.count(s)
    print(f"  {s}: {n}" + (" CLEAN" if n==0 else " REMAINING!"))


# The dead-code block is everything from the unreachable comment inside
# ais_ships() through to the end of _process_mock_vessels().
# Anchor start: the unreachable comment after the real return statement.
# Anchor end: just before the CelesTrak section comment.

# Strategy: find the FIRST occurrence of the unreachable comment
# then find the first CelesTrak comment after it.
ANCHOR_START = '\n    # \u2500\u2500 kept only to satisfy old indentation \u2014 unreachable'
ANCHOR_END   = '\n\n# \u2500'  # the blank lines + start of CelesTrak section

idx_start = txt.find(ANCHOR_START)
# Find the CelesTrak comment after the dead block
idx_end = txt.find(ANCHOR_END, idx_start + 10)

print(f"Dead block: chars {idx_start}..{idx_end}")
assert idx_start > 0, "Start anchor not found"
assert idx_end > idx_start, "End anchor not found"

# Replace dead block with just the two blank lines before CelesTrak
new_txt = txt[:idx_start] + txt[idx_end:]
print(f"After: {len(new_txt.splitlines())} lines")

# Verify syntax
ast.parse(new_txt)
print("Syntax OK")

# Write back
os.makedirs(os.path.dirname(f), exist_ok=True)
with open(f + '.bak', 'w', encoding='utf-8') as bak:
    bak.write(txt)
with open(f, 'w', encoding='utf-8') as out:
    out.write(new_txt)
print("Written successfully")

# Verify no mock refs remain
for s in ['MOCK_VESSELS', '_process_mock_vessels', '_MOCK_PLACEHOLDER', 'if False']:
    n = new_txt.count(s)
    if n:
        print(f"  WARNING: {n}x '{s}' still present")
    else:
        print(f"  OK: '{s}' gone")
